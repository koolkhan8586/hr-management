/**
 * LSAF-HR MANAGEMENT SYSTEM - BACKEND SERVER
 * Port: 5050
 * Features: Staff Hub, PKT Attendance, Payroll Posting, Loan Management
 */

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database Connection
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', 
    database: process.env.DB_NAME || 'hr_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- DATABASE AUTO-INITIALIZATION ---
// This ensures that the required tables exist so the "Refused" error doesn't occur.
db.query(`
    CREATE TABLE IF NOT EXISTS payroll_posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        month_year VARCHAR(10) UNIQUE,
        posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) console.error("Database Init Error (payroll_posts):", err.message);
    else console.log("Database Sync: payroll_posts table ready.");
});

// --- PAYROLL POSTING ENDPOINTS ---

// Get all months that have been authorized for employee viewing
app.get('/api/payroll-posted', (req, res) => {
    db.query('SELECT month_year FROM payroll_posts', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        // Return a simple array of strings for easier frontend handling
        res.json(results.map(r => r.month_year));
    });
});

// Authorize a specific month (Publish)
app.post('/api/payroll-post', (req, res) => {
    const { month } = req.body;
    if (!month) return res.status(400).json({ error: "Month is required" });
    
    db.query('INSERT IGNORE INTO payroll_posts (month_year) VALUES (?)', [month], (err) => {
        if (err) {
            console.error("Publish Error:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: `Month ${month} published successfully.` });
    });
});

// Remove authorization for a month (Unpublish)
app.delete('/api/payroll-post/:month', (req, res) => {
    db.query('DELETE FROM payroll_posts WHERE month_year = ?', [req.params.month], (err) => {
        if (err) {
            console.error("Unpublish Error:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: `Month ${req.params.month} unpublished.` });
    });
});

// --- EMPLOYEE HUB ROUTES ---

// Fetch all staff members
app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Create new staff identity
app.post('/api/employees', (req, res) => {
    const data = req.body;
    db.query('INSERT INTO employees SET ?', data, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Update profile or salary data (Used for both Directory and Salary Hub)
app.put('/api/employees/:id', (req, res) => {
    const data = req.body;
    const fields = [
        'name', 'role', 'email', 'password', 
        'basic_salary', 'invigilation', 't_payment', 'increment', 'eidi',
        'extra_leaves_deduction', 'tax', 'loan_deduction', 'insurance', 'others_deduction',
        'leave_annual', 'leave_casual'
    ];
    
    const updates = [];
    const values = [];
    
    fields.forEach(field => {
        if (data[field] !== undefined) {
            updates.push(`${field} = ?`);
            values.push(data[field]);
        }
    });

    if (updates.length === 0) return res.json({ message: "No fields to update" });

    db.query(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`, [...values, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Delete staff account
app.delete('/api/employees/:id', (req, res) => {
    db.query('DELETE FROM employees WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- ATTENDANCE ROUTES ---

// Fetch logs for specific employee
app.get('/api/attendance/:id', (req, res) => {
    db.query('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date_str DESC, time_str DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Fetch all logs (Admin Export)
app.get('/api/attendance', (req, res) => {
    const query = `
        SELECT a.*, e.name as employee_name 
        FROM attendance a 
        JOIN employees e ON a.employee_id = e.id 
        ORDER BY a.date_str DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Post new log
app.post('/api/attendance', (req, res) => {
    const { employeeId, type, date, time, lat, lng } = req.body;
    db.query('INSERT INTO attendance (employee_id, type, date_str, time_str, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)', 
    [employeeId, type, date, time, lat, lng], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Manual Log Adjustment (Admin)
app.put('/api/attendance/:id', (req, res) => {
    const { type, time_str } = req.body;
    db.query('UPDATE attendance SET type = ?, time_str = ? WHERE id = ?', [type, time_str, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- LOAN & DISCUSSION ROUTES ---

app.get('/api/loans', (req, res) => {
    db.query('SELECT l.*, e.name as employee_name FROM loans l JOIN employees e ON l.employee_id = e.id', (err, results) => {
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

// SERVER START
const PORT = 5050;
app.listen(PORT, () => {
    console.log(`-------------------------------------------`);
    console.log(`LSAF NexusHR Backend Active on Port ${PORT}`);
    console.log(`PKT Timezone Synchronization: Active`);
    console.log(`-------------------------------------------`);
});
