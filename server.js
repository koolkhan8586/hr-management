/**
 * LSAF-HR MANAGEMENT SYSTEM - BACKEND SERVER
 * Features: Staff Hub, PKT Attendance with Email, Payroll, Leaves, Loans
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

/**
 * EMAIL CONFIGURATION (Nodemailer)
 * Requirement: Update EMAIL_USER and EMAIL_PASS in your .env file
 */
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS // Use a Google App Password
    }
});

/**
 * --- DATABASE AUTO-INITIALIZATION ---
 * Ensures the database schema matches the latest application requirements.
 */
const initDB = () => {
    console.log("LSAFHR: Synchronizing Core Matrix...");

    const migrations = [
        `ALTER TABLE employees ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
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
            if (err && err.code !== 'ER_DUP_FIELDNAME') console.log("Migration Note:", err.message);
        });
    });

    // Create essential tables if they don't exist
    const tables = [
        `CREATE TABLE IF NOT EXISTS payroll_posts (id INT AUTO_INCREMENT PRIMARY KEY, month_year VARCHAR(10) UNIQUE, posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS leaves (id INT AUTO_INCREMENT PRIMARY KEY, employee_id VARCHAR(50), leave_type VARCHAR(50), start_date DATE, days INT, reason TEXT, status VARCHAR(20) DEFAULT 'Pending', applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    ];

    tables.forEach(sql => db.query(sql));
    console.log("Database Sync: LSAFHR Tables Ready.");
};
initDB();

// --- ATTENDANCE WITH EMAIL NOTIFICATION ---

app.post('/api/attendance', (req, res) => {
    const { employee_id, type, date_str, time_str, latitude, longitude } = req.body;
    
    // 1. Log to Database
    const sql = `INSERT INTO attendance (employee_id, type, date_str, time_str, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)`;
    db.query(sql, [employee_id, type, date_str, time_str, latitude, longitude], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        // 2. Trigger Identity Email
        db.query('SELECT name, email FROM employees WHERE id = ?', [employee_id], (err, results) => {
            if (!err && results.length > 0 && results[0].email) {
                const emp = results[0];
                const mailOptions = {
                    from: `"LSAFHR System" <${process.env.EMAIL_USER}>`,
                    to: emp.email,
                    subject: `Attendance Mark Verified: ${type}`,
                    html: `
                        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 500px;">
                            <h2 style="color: #15803d; margin-top: 0;">LSAFHR Identity Verification</h2>
                            <p>Hello <b>${emp.name}</b>,</p>
                            <p>Your attendance has been successfully verified via the Geofence matrix:</p>
                            <div style="background: #f8fafc; padding: 15px; border-radius: 8px;">
                                <p style="margin: 5px 0;"><b>Action:</b> ${type}</p>
                                <p style="margin: 5px 0;"><b>Timestamp:</b> ${date_str} @ ${time_str}</p>
                                <p style="margin: 5px 0;"><b>Coordinates:</b> ${latitude}, ${longitude}</p>
                            </div>
                            <p style="color: #64748b; font-size: 11px; margin-top: 20px;">This is an automated system notification.</p>
                        </div>
                    `
                };

                transporter.sendMail(mailOptions, (mailErr) => {
                    if (mailErr) console.error("Email Delivery Error:", mailErr.message);
                    else console.log(`Notification sent to ${emp.email}`);
                });
            }
        });

        res.json({ success: true, message: "Mark verified and email queued." });
    });
});

app.get('/api/attendance/:id', (req, res) => {
    db.query('SELECT * FROM attendance WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results || []);
    });
});

// --- STAFF HUB & SALARY MATRIX ROUTES ---

app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees ORDER BY id ASC', (err, r) => res.json(r || []));
});

app.post('/api/employees', (req, res) => {
    db.query('INSERT INTO employees SET ?', req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.put('/api/employees/:id', (req, res) => {
    db.query('UPDATE employees SET ? WHERE id = ?', [req.body, req.params.id], (err) => {
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

/**
 * BULK WIPE ROUTE
 * Zeros out all financial columns for every employee in one transaction.
 */
app.post('/api/employees/wipe-ledger', (req, res) => {
    const sql = `UPDATE employees SET 
        basic_salary = 0, invigilation = 0, t_payment = 0, increment = 0, 
        eidi = 0, tax = 0, loan_deduction = 0, insurance = 0, 
        others_deduction = 0, extra_leaves_deduction = 0`;
    db.query(sql, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.post('/api/employees/reset-salary/:id', (req, res) => {
    const sql = `UPDATE employees SET basic_salary=0, invigilation=0, t_payment=0, increment=0, eidi=0, tax=0, loan_deduction=0, insurance=0, others_deduction=0, extra_leaves_deduction=0 WHERE id = ?`;
    db.query(sql, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- LEAVES HUB ---

app.get('/api/leaves/:id', (req, res) => {
    db.query('SELECT * FROM leaves WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, r) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(r || []);
    });
});

app.post('/api/leaves', (req, res) => {
    const { employeeId, type, startDate, days, reason } = req.body;
    const sql = `INSERT INTO leaves (employee_id, leave_type, start_date, days, reason) VALUES (?, ?, ?, ?, ?)`;
    db.query(sql, [employeeId, type, startDate, days, reason], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// --- PAYROLL POSTING ---

app.get('/api/payroll-posted', (req, res) => {
    db.query('SELECT month_year FROM payroll_posts', (err, r) => {
        res.json((r || []).map(x => x.month_year));
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

// --- SERVER START ---
const PORT = 5050;
app.listen(PORT, () => {
    console.log(`LSAFHR Backend Operational on Port ${PORT}`);
});
