/**
 * LSAFHR MANAGEMENT SYSTEM - COMPLETE BACKEND
 * Port: 5050
 * Database: hr_management
 * Features: Staff Hub, Attendance Sync, Payroll Management, Loan & Leave Tracking
 */

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database Connection
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', 
    database: 'hr_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- DATABASE AUTO-MIGRATION & INIT ---
const initDB = () => {
    // Ensure Schema supports all modern LSAFHR features
    db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS loan_opening_balance DECIMAL(15,2) DEFAULT 0`, (err) => {
        if (!err) console.log("LSAFHR: loan_opening_balance column verified.");
    });
    db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS password VARCHAR(255)`, (err) => {
        if (!err) console.log("LSAFHR: password column verified.");
    });
    db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_annual INT DEFAULT 14`, (err) => {
        if (!err) console.log("LSAFHR: leave_annual column verified.");
    });
    db.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_casual INT DEFAULT 10`, (err) => {
        if (!err) console.log("LSAFHR: leave_casual column verified.");
    });
};
initDB();

// --- EMPLOYEE / STAFF HUB ROUTES ---

app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees ORDER BY id ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/employees', (req, res) => {
    const data = req.body;
    db.query('INSERT INTO employees SET ?', data, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Staff identity created." });
    });
});

app.put('/api/employees/:id', (req, res) => {
    const data = req.body;
    const fields = [
        'name', 'role', 'email', 'password', 'basic_salary', 'invigilation', 
        't_payment', 'increment', 'extra_leaves_deduction', 'tax', 
        'loan_deduction', 'insurance', 'others_deduction', 
        'leave_annual', 'leave_casual', 'loan_opening_balance', 'eidi'
    ];
    
    const updates = [];
    const values = [];
    
    fields.forEach(field => {
        if (data[field] !== undefined) {
            updates.push(`${field} = ?`);
            values.push(data[field]);
        }
    });

    if (updates.length === 0) return res.json({ message: "No data to update" });

    db.query(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`, [...values, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Matrix updated." });
    });
});

app.delete('/api/employees/:id', (req, res) => {
    db.query('DELETE FROM employees WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Identity purged." });
    });
});

// --- ATTENDANCE ROUTES ---

app.get('/api/attendance/:id', (req, res) => {
    db.query('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date_str DESC, time_str DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/attendance', (req, res) => {
    const { employeeId, type, date, time, lat, lng } = req.body;
    db.query('INSERT INTO attendance (employee_id, type, date_str, time_str, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)', 
    [employeeId, type, date, time, lat, lng], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- PAYROLL POSTING ROUTES ---

app.get('/api/payroll-posted', (req, res) => {
    db.query('SELECT month_year FROM payroll_posts', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results.map(r => r.month_year));
    });
});

app.post('/api/payroll-post', (req, res) => {
    const { month } = req.body;
    db.query('INSERT IGNORE INTO payroll_posts (month_year) VALUES (?)', [month], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/payroll-post/:month', (req, res) => {
    db.query('DELETE FROM payroll_posts WHERE month_year = ?', [req.params.month], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- LOAN & LEAVE MANAGEMENT ---

app.get('/api/loans', (req, res) => {
    const query = `
        SELECT l.*, e.name as employee_name 
        FROM loans l 
        JOIN employees e ON l.employee_id = e.id 
        ORDER BY l.id DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/loans', (req, res) => {
    const { employeeId, totalAmount, reason } = req.body;
    db.query('INSERT INTO loans (employee_id, total_amount, reason, status, date_granted) VALUES (?, ?, ?, "Pending", NOW())', 
    [employeeId, totalAmount, reason], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/leaves', (req, res) => {
    const query = `
        SELECT lv.*, e.name as employee_name 
        FROM leaves lv 
        JOIN employees e ON lv.employee_id = e.id 
        ORDER BY lv.id DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.get('/api/leaves/:id', (req, res) => {
    db.query('SELECT * FROM leaves WHERE employee_id = ? ORDER BY start_date DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/leaves', (req, res) => {
    const { employeeId, type, startDate, days, reason } = req.body;
    db.query('INSERT INTO leaves (employee_id, leave_type, start_date, days, reason, status) VALUES (?, ?, ?, ?, ?, "Pending")', 
    [employeeId, type, startDate, days, reason], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.put('/api/leaves/:id', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE leaves SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- DISCUSSION BOARD ---

app.get('/api/discussions', (req, res) => {
    db.query('SELECT * FROM discussions ORDER BY id DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/discussions', (req, res) => {
    const { title, message, senderName, senderId, date } = req.body;
    db.query('INSERT INTO discussions (title, message, senderName, senderId, date) VALUES (?, ?, ?, ?, ?)', 
    [title, message, senderName, senderId, date], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- WELCOME EMAIL STUB ---
app.post('/api/send-welcome-email', (req, res) => {
    const { email, id, pass, name } = req.body;
    console.log(`Welcome Email Triggered for ${name} (${email}). Password: ${pass}`);
    // Logic for SMTP would go here
    res.json({ success: true, message: "Email queued." });
});

// SERVER START
const PORT = 5050;
app.listen(PORT, () => {
    console.log(`-------------------------------------------`);
    console.log(`LSAFHR Backend System Active on Port ${PORT}`);
    console.log(`Matrix Protocol: Synchronized`);
    console.log(`-------------------------------------------`);
});
