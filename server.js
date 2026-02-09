/**
 * LSAF-HR MANAGEMENT SYSTEM - BACKEND SERVER
 * Port: 5050
 * Features: Staff Hub, PKT Attendance, Payroll Posting, Loan Management, Bulk Wipe
 */

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database Connection Configuration
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
const initDB = () => {
    console.log("LSAFHR: Checking Database Integrity...");

    // Migration: Ensure EVERY necessary column exists for LSAFHR features
    // This script adds missing columns to existing tables without deleting old data.
    const migrations = [
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS loan_opening_balance DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS eidi DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS others_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS extra_leaves_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS basic_salary DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS invigilation DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS t_payment DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS increment DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS tax DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS loan_deduction DECIMAL(15,2) DEFAULT 0`
    ];

    migrations.forEach(sql => {
        db.query(sql, (err) => {
            if (err && err.code !== 'ER_DUP_FIELDNAME') {
                console.log("Migration Note:", err.message);
            }
        });
    });

    db.query(`
        CREATE TABLE IF NOT EXISTS payroll_posts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            month_year VARCHAR(10) UNIQUE,
            posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) console.error("Database Init Error (payroll_posts):", err.message);
        else console.log("Database Sync: LSAFHR Tables and Columns verified.");
    });
};
initDB();

// --- PAYROLL POSTING ENDPOINTS ---

app.get('/api/payroll-posted', (req, res) => {
    db.query('SELECT month_year FROM payroll_posts', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results.map(r => r.month_year));
    });
});

app.post('/api/payroll-post', (req, res) => {
    const { month } = req.body;
    if (!month) return res.status(400).json({ error: "Month is required" });
    
    db.query('INSERT IGNORE INTO payroll_posts (month_year) VALUES (?)', [month], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: `Month ${month} published.` });
    });
});

app.delete('/api/payroll-post/:month', (req, res) => {
    db.query('DELETE FROM payroll_posts WHERE month_year = ?', [req.params.month], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: `Month ${req.params.month} unpublished.` });
    });
});

// --- EMPLOYEE HUB & SALARY HUB ROUTES ---

app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees ORDER BY id ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/employees', (req, res) => {
    db.query('INSERT INTO employees SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

/**
 * SALARY WIPE (BULK RESET)
 * Sets all monthly financial figures to 0 for all staff.
 */
app.post('/api/employees/wipe-ledger', (req, res) => {
    console.log("LSAFHR: Wiping monthly ledger data...");
    const sql = `UPDATE employees SET 
        basic_salary = 0, 
        invigilation = 0, 
        t_payment = 0, 
        increment = 0, 
        eidi = 0, 
        tax = 0, 
        loan_deduction = 0, 
        insurance = 0, 
        others_deduction = 0, 
        extra_leaves_deduction = 0`;
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Wipe Error:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: `Ledger wiped for ${results.affectedRows} employees.` });
    });
});

/**
 * INDIVIDUAL SALARY RESET (Used by the "Delete" trash icon in Salary Hub)
 */
app.post('/api/employees/reset-salary/:id', (req, res) => {
    const sql = `UPDATE employees SET 
        basic_salary = 0, 
        invigilation = 0, 
        t_payment = 0, 
        increment = 0, 
        eidi = 0, 
        tax = 0, 
        loan_deduction = 0, 
        insurance = 0, 
        others_deduction = 0, 
        extra_leaves_deduction = 0 
        WHERE id = ?`;
    
    db.query(sql, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: "Individual salary record reset." });
    });
});

/**
 * UPDATED PUT ROUTE
 * Handles editing staff profiles and saving monthly salary updates.
 * Includes sanitization for numeric fields to prevent MySQL errors.
 */
app.put('/api/employees/:id', (req, res) => {
    const data = req.body;
    
    const fields = [
        'name', 'role', 'email', 'password', 
        'basic_salary', 'invigilation', 't_payment', 'increment', 'eidi',
        'extra_leaves_deduction', 'tax', 'loan_deduction', 'insurance', 'others_deduction',
        'leave_annual', 'leave_casual', 'loan_opening_balance'
    ];

    const numericFields = [
        'basic_salary', 'invigilation', 't_payment', 'increment', 'eidi',
        'extra_leaves_deduction', 'tax', 'loan_deduction', 'insurance', 
        'others_deduction', 'leave_annual', 'leave_casual', 'loan_opening_balance'
    ];
    
    const updates = [];
    const values = [];
    
    fields.forEach(field => {
        if (data[field] !== undefined) {
            let val = data[field];
            
            // Sanitization: Convert empty inputs to numeric 0 for database compatibility
            if (numericFields.includes(field)) {
                if (val === '' || val === null || isNaN(val)) {
                    val = 0;
                } else {
                    val = parseFloat(val);
                }
            }
            
            updates.push(`${field} = ?`);
            values.push(val);
        }
    });

    if (updates.length === 0) return res.json({ message: "No data changed." });

    db.query(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`, [...values, req.params.id], (err, results) => {
        if (err) {
            console.error("SQL Save Error:", err.message);
            return res.status(500).json({ error: err.message });
        }
        if (results.affectedRows === 0) return res.status(404).json({ error: "Identity not found" });
        res.json({ success: true });
    });
});

app.delete('/api/employees/:id', (req, res) => {
    db.query('DELETE FROM employees WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- ATTENDANCE ROUTES ---

app.get('/api/attendance/:id', (req, res) => {
    db.query('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date_str DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

app.post('/api/attendance', (req, res) => {
    db.query('INSERT INTO attendance SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- LOAN ROUTES ---

app.get('/api/loans', (req, res) => {
    db.query('SELECT l.*, e.name as employee_name FROM loans l JOIN employees e ON l.employee_id = e.id ORDER BY l.id DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
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

// --- DISCUSSIONS (BOARD) ---

app.get('/api/discussions', (req, res) => {
    db.query('SELECT * FROM discussions ORDER BY id DESC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
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
    console.log(`-------------------------------------------`);
    console.log(`LSAFHR Backend Operational on Port ${PORT}`);
    console.log(`-------------------------------------------`);
});
