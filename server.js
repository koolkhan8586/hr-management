/**
 * LSAFHR MANAGEMENT SYSTEM - COMPLETE BACKEND (Robust Version)
 * Port: 5050
 * Database: hr_management
 * Features: Auto-table creation, Staff Hub, Attendance Sync, Payroll, Loans & Leaves
 */

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database Connection Configuration
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', // Enter your MySQL root password here if set
    database: 'hr_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

/**
 * --- DATABASE INITIALIZATION ---
 * Automatically creates tables and adds missing columns on startup.
 */
const initSystem = async () => {
    console.log("LSAFHR: Initializing Core Matrix...");

    // Test connection
    try {
        await db.promise().query("SELECT 1");
        console.log("LSAFHR: Database Connection Verified.");
    } catch (err) {
        console.error("CRITICAL: Database connection failed! Check your credentials.");
        console.error(err.message);
        return;
    }

    const tables = [
        `CREATE TABLE IF NOT EXISTS employees (
            id VARCHAR(50) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            password VARCHAR(255),
            role VARCHAR(50) DEFAULT 'employee',
            basic_salary DECIMAL(15,2) DEFAULT 0,
            invigilation DECIMAL(15,2) DEFAULT 0,
            t_payment DECIMAL(15,2) DEFAULT 0,
            increment DECIMAL(15,2) DEFAULT 0,
            extra_leaves_deduction DECIMAL(15,2) DEFAULT 0,
            tax DECIMAL(15,2) DEFAULT 0,
            loan_deduction DECIMAL(15,2) DEFAULT 0,
            insurance DECIMAL(15,2) DEFAULT 0,
            others_deduction DECIMAL(15,2) DEFAULT 0,
            leave_annual INT DEFAULT 14,
            leave_casual INT DEFAULT 10,
            loan_opening_balance DECIMAL(15,2) DEFAULT 0,
            eidi DECIMAL(15,2) DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS attendance (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id VARCHAR(50),
            type VARCHAR(20),
            date_str DATE,
            time_str VARCHAR(20),
            latitude VARCHAR(50),
            longitude VARCHAR(50)
        )`,
        `CREATE TABLE IF NOT EXISTS payroll_posts (
            month_year VARCHAR(10) PRIMARY KEY
        )`,
        `CREATE TABLE IF NOT EXISTS loans (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id VARCHAR(50),
            total_amount DECIMAL(15,2),
            paid_amount DECIMAL(15,2) DEFAULT 0,
            reason TEXT,
            status VARCHAR(20) DEFAULT 'Pending',
            date_granted TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS leaves (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id VARCHAR(50),
            leave_type VARCHAR(50),
            start_date DATE,
            days INT,
            reason TEXT,
            status VARCHAR(20) DEFAULT 'Pending'
        )`,
        `CREATE TABLE IF NOT EXISTS discussions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255),
            message TEXT,
            senderName VARCHAR(255),
            senderId VARCHAR(50),
            date DATETIME
        )`
    ];

    // Execute table creations
    for (let sql of tables) {
        await db.promise().query(sql).catch(err => console.error("Table Init Error:", err.message));
    }

    // Secondary Migration: Add columns that might be missing in older LSAFHR versions
    const migrations = [
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS loan_opening_balance DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS eidi DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_annual INT DEFAULT 14`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_casual INT DEFAULT 10`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS password VARCHAR(255)`
    ];

    for (let sql of migrations) {
        try { 
            await db.promise().query(sql); 
        } catch (e) { 
            // Silent catch for versions that don't support 'IF NOT EXISTS' in ALTER
        }
    }

    console.log("LSAFHR Backend: Database Synchronized and Tables Verified.");
};

initSystem();

// --- API ROUTES ---

// Employees - GET all
app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees ORDER BY id ASC', (err, results) => {
        if (err) return res.status(500).json({ error: "Fetch error: " + err.message });
        res.json(results);
    });
});

// Employees - CREATE
app.post('/api/employees', (req, res) => {
    db.query('INSERT INTO employees SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: "Create error: " + err.message });
        res.json({ success: true });
    });
});

// Employees - UPDATE (Used for Staff Hub editing and Salary Hub saving/wiping)
app.put('/api/employees/:id', (req, res) => {
    const data = req.body;
    const id = req.params.id;

    const fields = [
        'name', 'role', 'email', 'password', 'basic_salary', 'invigilation', 
        't_payment', 'increment', 'extra_leaves_deduction', 'tax', 
        'loan_deduction', 'insurance', 'others_deduction', 
        'leave_annual', 'leave_casual', 'loan_opening_balance', 'eidi'
    ];
    
    const updates = [];
    const values = [];
    
    fields.forEach(f => {
        if (data[f] !== undefined) {
            updates.push(`${f} = ?`);
            values.push(data[f]);
        }
    });

    if (updates.length === 0) return res.json({ success: true, message: "No data changed." });

    db.query(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`, [...values, id], (err, results) => {
        if (err) return res.status(500).json({ error: "Update error: " + err.message });
        if (results.affectedRows === 0) return res.status(404).json({ error: "Employee not found." });
        res.json({ success: true });
    });
});

// Employees - DELETE
app.delete('/api/employees/:id', (req, res) => {
    db.query('DELETE FROM employees WHERE id = ?', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: "Delete error: " + err.message });
        if (results.affectedRows === 0) return res.status(404).json({ error: "Employee not found." });
        res.json({ success: true });
    });
});

// Attendance
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

// Payroll Posting Control
app.get('/api/payroll-posted', (req, res) => {
    db.query('SELECT month_year FROM payroll_posts', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results.map(r => r.month_year));
    });
});

app.post('/api/payroll-post', (req, res) => {
    db.query('INSERT IGNORE INTO payroll_posts (month_year) VALUES (?)', [req.body.month], (err) => {
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

// Loans & Leaves
app.get('/api/loans', (req, res) => {
    db.query('SELECT l.*, e.name as employee_name FROM loans l JOIN employees e ON l.employee_id = e.id ORDER BY l.id DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/loans', (req, res) => {
    const { employeeId, totalAmount, reason } = req.body;
    db.query('INSERT INTO loans (employee_id, total_amount, reason, status) VALUES (?, ?, ?, "Pending")', 
    [employeeId, totalAmount, reason], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/leaves', (req, res) => {
    db.query('SELECT lv.*, e.name as employee_name FROM leaves lv JOIN employees e ON lv.employee_id = e.id ORDER BY lv.id DESC', (err, results) => {
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
    db.query('UPDATE leaves SET status = ? WHERE id = ?', [req.body.status, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Discussions Board
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

// Start Server
const PORT = 5050;
app.listen(PORT, () => {
    console.log(`LSAFHR Backend Operational on Port ${PORT}`);
    console.log(`API Hub: http://localhost:${PORT}/api`);
    console.log(`-------------------------------------------`);
});
