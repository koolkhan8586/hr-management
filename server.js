/**
 * LSAF-HR MANAGEMENT SYSTEM - COMPLETE BACKEND SERVER (v7.3.0)
 * Core Logic: Staff Hub, Geofence Attendance, Payroll Ledger, WOP Leaves, Loans, Board
 * Dependencies: express, mysql2, cors, nodemailer, dotenv
 */

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// Database Connection Pool
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', 
    database: process.env.DB_NAME || 'hr_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

/**
 * EMAIL CONFIGURATION (Nodemailer)
 */
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    }
});

/**
 * --- DATABASE AUTO-MIGRATION ---
 */
const runMigrations = () => {
    console.log("LSAFHR: Synchronizing Full Identity Matrix...");

    const columnMigrations = [
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS password VARCHAR(255)`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'employee'`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS loan_opening_balance DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_annual INT DEFAULT 14`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_casual INT DEFAULT 10`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS basic_salary DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS invigilation DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS t_payment DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS increment DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS eidi DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS tax DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS loan_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS others_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS extra_leaves_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8)`,
        `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8)`
    ];

    columnMigrations.forEach(sql => {
        db.query(sql, (err) => {
            if (err && err.code !== 'ER_DUP_FIELDNAME') console.log("LSAFHR Sync Note:", err.message);
        });
    });

    const tableMigrations = [
        `CREATE TABLE IF NOT EXISTS payroll_posts (id INT AUTO_INCREMENT PRIMARY KEY, month_year VARCHAR(10) UNIQUE, posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS leaves (id INT AUTO_INCREMENT PRIMARY KEY, employee_id VARCHAR(50), leave_type VARCHAR(50), start_date DATE, days INT, reason TEXT, status VARCHAR(20) DEFAULT 'Pending', applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS loans (id INT AUTO_INCREMENT PRIMARY KEY, employee_id VARCHAR(50), amount DECIMAL(15,2), reason TEXT, status VARCHAR(20) DEFAULT 'Pending', applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS discussions (id INT AUTO_INCREMENT PRIMARY KEY, employee_id VARCHAR(50), author_name VARCHAR(255), message TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    ];

    tableMigrations.forEach(sql => db.query(sql));
    console.log("LSAFHR: Matrix Connection Established.");
};
runMigrations();

// --- ATTENDANCE MODULE ---

app.post('/api/attendance', (req, res) => {
    const { employee_id, type, date_str, time_str, latitude, longitude } = req.body;
    const sql = `INSERT INTO attendance (employee_id, type, date_str, time_str, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)`;
    db.query(sql, [employee_id, type, date_str, time_str, latitude, longitude], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.query('SELECT name, email FROM employees WHERE id = ?', [employee_id], (err, results) => {
            if (!err && results.length > 0 && results[0].email) {
                const emp = results[0];
                const mailOptions = {
                    from: `"LSAFHR System" <${process.env.EMAIL_USER}>`,
                    to: emp.email,
                    subject: `Attendance Mark Verified: ${type}`,
                    html: `<h3>Identity Verified</h3><p>Hello ${emp.name}, your ${type} at ${time_str} has been logged.</p>`
                };
                transporter.sendMail(mailOptions);
            }
        });
        res.json({ success: true });
    });
});

app.get('/api/attendance/:id', (req, res) => {
    db.query('SELECT * FROM attendance WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, results) => {
        res.json(results || []);
    });
});

app.delete('/api/attendance-entry/:id', (req, res) => {
    db.query('DELETE FROM attendance WHERE id = ?', [req.params.id], (err) => res.json({ success: true }));
});

app.put('/api/attendance-entry/:id', (req, res) => {
    const { time_str, type } = req.body;
    db.query('UPDATE attendance SET time_str = ?, type = ? WHERE id = ?', [time_str, type, req.params.id], (err) => res.json({ success: true }));
});

// --- STAFF HUB MODULE ---

app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees ORDER BY id ASC', (err, r) => res.json(r || []));
});

app.post('/api/employees', (req, res) => {
    db.query('INSERT INTO employees SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        const mailOptions = {
            from: `"LSAFHR System" <${process.env.EMAIL_USER}>`,
            to: req.body.email,
            subject: `Welcome to LSAFHR Core`,
            html: `<h2>Welcome</h2><p>ID: ${req.body.id}<br>Key: ${req.body.password}</p><p>URL: ${process.env.PORTAL_URL || 'Check with Admin'}</p>`
        };
        transporter.sendMail(mailOptions);
        res.json({ success: true });
    });
});

app.put('/api/employees/:id', (req, res) => {
    const data = { ...req.body };
    delete data.id; 
    db.query('UPDATE employees SET ? WHERE id = ?', [data, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/employees/:id', (req, res) => {
    db.query('DELETE FROM attendance WHERE employee_id = ?', [req.params.id], () => {
        db.query('DELETE FROM employees WHERE id = ?', [req.params.id], (err) => res.json({ success: true }));
    });
});

// --- LEAVES MODULE ---

app.get('/api/leaves/:id', (req, res) => {
    db.query('SELECT * FROM leaves WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, r) => res.json(r || []));
});

app.post('/api/leaves', (req, res) => {
    db.query('INSERT INTO leaves SET ?', {
        employee_id: req.body.employeeId,
        leave_type: req.body.type,
        start_date: req.body.startDate,
        days: req.body.days,
        reason: req.body.reason
    }, (err) => {
        db.query('SELECT name, email FROM employees WHERE id = ?', [req.body.employeeId], (err, results) => {
            if (!err && results.length > 0) {
                transporter.sendMail({
                    from: `"LSAFHR System"`, to: results[0].email,
                    subject: `Leave Request Logged`,
                    html: `<p>Your request for ${req.body.type} has been initialized.</p>`
                });
            }
        });
        res.json({ success: true });
    });
});

// --- LOANS MODULE ---

app.get('/api/loans/:id', (req, res) => {
    db.query('SELECT * FROM loans WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, r) => res.json(r || []));
});

app.post('/api/loans', (req, res) => {
    db.query('INSERT INTO loans SET ?', {
        employee_id: req.body.employeeId,
        amount: req.body.amount,
        reason: req.body.reason
    }, (err) => {
        db.query('SELECT name, email FROM employees WHERE id = ?', [req.body.employeeId], (err, results) => {
            if (!err && results.length > 0) {
                transporter.sendMail({
                    from: `"LSAFHR System"`, to: results[0].email,
                    subject: `Loan Application Matrix`,
                    html: `<p>Loan application of Rs. ${req.body.amount} received.</p>`
                });
            }
        });
        res.json({ success: true });
    });
});

// --- DISCUSSION BOARD ---

app.get('/api/discussions', (req, res) => {
    db.query('SELECT * FROM discussions ORDER BY id DESC LIMIT 50', (err, r) => res.json(r || []));
});

app.post('/api/discussions', (req, res) => {
    db.query('INSERT INTO discussions SET ?', req.body, (err) => {
        // Send alert to all employees for board updates
        db.query('SELECT email FROM employees', (err, emps) => {
            if (!err) {
                const emails = emps.map(e => e.email).filter(e => e).join(',');
                transporter.sendMail({
                    from: `"LSAFHR Board"`, to: emails,
                    subject: `New Board Broadcast`,
                    html: `<p><b>${req.body.author_name}:</b> ${req.body.message}</p>`
                });
            }
        });
        res.json({ success: true });
    });
});

// --- PAYROLL & BULK ---

app.post('/api/employees/wipe-ledger', (req, res) => {
    db.query(`UPDATE employees SET basic_salary=0, invigilation=0, t_payment=0, increment=0, eidi=0, tax=0, loan_deduction=0, insurance=0, others_deduction=0, extra_leaves_deduction=0`, (err) => res.json({ success: true }));
});

app.get('/api/payroll-posted', (req, res) => {
    db.query('SELECT month_year FROM payroll_posts', (err, r) => res.json((r || []).map(x => x.month_year)));
});

app.post('/api/payroll-post', (req, res) => {
    db.query('INSERT IGNORE INTO payroll_posts (month_year) VALUES (?)', [req.body.month], (err) => res.json({ success: true }));
});

app.delete('/api/payroll-post/:month', (req, res) => {
    db.query('DELETE FROM payroll_posts WHERE month_year = ?', [req.params.month], (err) => res.json({ success: true }));
});

const PORT = 5050;
app.listen(PORT, () => console.log(`LSAFHR Backend Operational on Port ${PORT}`));
