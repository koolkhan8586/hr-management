/**
 * LSAFHR MANAGEMENT SYSTEM - COMPLETE BACKEND
 * Port: 5050 | Project: LSAFHR
 * Features: Auto-schema, Full CRUD, Attendance, Payroll, Loans, Leaves
 */

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' })); // Allow all for maximum compatibility
app.use(express.json());

// Database Connection
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', // Enter your MySQL root password here
    database: 'hr_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// --- DATABASE AUTO-SYNC ---
const initSystem = async () => {
    console.log("LSAFHR: Checking Matrix Integrity...");
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
            reason TEXT,
            status VARCHAR(20) DEFAULT 'Pending'
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

    for (let sql of tables) {
        await db.promise().query(sql).catch(e => console.log("LSAFHR Init Note:", e.message));
    }

    // Ensure specific columns exist if tables were created previously
    const cols = ['loan_opening_balance', 'eidi', 'leave_annual', 'leave_casual', 'password'];
    for (let col of cols) {
        try {
            const sql = (col === 'leave_annual' || col === 'leave_casual') 
                ? `ALTER TABLE employees ADD COLUMN ${col} INT DEFAULT 10`
                : `ALTER TABLE employees ADD COLUMN ${col} DECIMAL(15,2) DEFAULT 0`;
            await db.promise().query(sql);
        } catch (e) {} 
    }
    console.log("LSAFHR: Database Schema Verified.");
};
initSystem();

// --- ROUTES ---

app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees ORDER BY id ASC', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

app.post('/api/employees', (req, res) => {
    db.query('INSERT INTO employees SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
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
    fields.forEach(f => {
        if (data[f] !== undefined) {
            updates.push(`${f} = ?`);
            values.push(data[f]);
        }
    });
    if (updates.length === 0) return res.json({ success: true });
    db.query(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`, [...values, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/employees/:id', (req, res) => {
    db.query('DELETE FROM employees WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Attendance, Posting, Loans, Leaves remain consistent...
app.get('/api/attendance/:id', (req, res) => { db.query('SELECT * FROM attendance WHERE employee_id = ? ORDER BY date_str DESC', [req.params.id], (err, results) => res.json(results)); });
app.post('/api/attendance', (req, res) => { db.query('INSERT INTO attendance SET ?', req.body, (err) => res.json({success:true})); });
app.get('/api/payroll-posted', (req, res) => { db.query('SELECT month_year FROM payroll_posts', (err, results) => res.json(results.map(r => r.month_year))); });
app.post('/api/payroll-post', (req, res) => { db.query('INSERT IGNORE INTO payroll_posts SET ?', { month_year: req.body.month }, (err) => res.json({success:true})); });
app.delete('/api/payroll-post/:month', (req, res) => { db.query('DELETE FROM payroll_posts WHERE month_year = ?', [req.params.month], (err) => res.json({success:true})); });
app.get('/api/loans', (req, res) => { db.query('SELECT l.*, e.name as employee_name FROM loans l JOIN employees e ON l.employee_id = e.id', (err, results) => res.json(results)); });
app.post('/api/loans', (req, res) => { db.query('INSERT INTO loans SET ?', { employee_id: req.body.employeeId, total_amount: req.body.totalAmount, reason: req.body.reason }, (err) => res.json({success:true})); });
app.get('/api/leaves', (req, res) => { db.query('SELECT lv.*, e.name as employee_name FROM leaves lv JOIN employees e ON lv.employee_id = e.id', (err, results) => res.json(results)); });
app.get('/api/leaves/:id', (req, res) => { db.query('SELECT * FROM leaves WHERE employee_id = ?', [req.params.id], (err, results) => res.json(results)); });
app.post('/api/leaves', (req, res) => { db.query('INSERT INTO leaves SET ?', { employee_id: req.body.employeeId, leave_type: req.body.type, start_date: req.body.startDate, days: req.body.days, reason: req.body.reason }, (err) => res.json({success:true})); });
app.put('/api/leaves/:id', (req, res) => { db.query('UPDATE leaves SET status = ? WHERE id = ?', [req.body.status, req.params.id], (err) => res.json({success:true})); });
app.get('/api/discussions', (req, res) => { db.query('SELECT * FROM discussions ORDER BY id DESC', (err, results) => res.json(results)); });
app.post('/api/discussions', (req, res) => { db.query('INSERT INTO discussions SET ?', req.body, (err) => res.json({success:true})); });

const PORT = 5050;
app.listen(PORT, () => console.log(`LSAFHR Backend Operational on Port ${PORT}`));
