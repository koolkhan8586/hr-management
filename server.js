/**
 * LSAF-HR MANAGEMENT SYSTEM - COMPLETE BACKEND SERVER (v7.5.0)
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
 * Defence against missing columns. catching errors for universal MySQL support.
 */
const runMigrations = () => {
    console.log("LSAFHR: Synchronizing Full Identity Matrix...");

    const columnMigrations = [
        `ALTER TABLE employees ADD COLUMN email VARCHAR(255)`,
        `ALTER TABLE employees ADD COLUMN password VARCHAR(255)`,
        `ALTER TABLE employees ADD COLUMN role VARCHAR(50) DEFAULT 'employee'`,
        `ALTER TABLE employees ADD COLUMN loan_opening_balance DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN leave_annual INT DEFAULT 14`,
        `ALTER TABLE employees ADD COLUMN leave_casual INT DEFAULT 10`,
        `ALTER TABLE employees ADD COLUMN basic_salary DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN invigilation DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN t_payment DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN increment DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN eidi DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN tax DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN loan_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN insurance DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN others_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE employees ADD COLUMN extra_leaves_deduction DECIMAL(15,2) DEFAULT 0`,
        `ALTER TABLE attendance ADD COLUMN latitude DECIMAL(10,8)`,
        `ALTER TABLE attendance ADD COLUMN longitude DECIMAL(11,8)`
    ];

    columnMigrations.forEach(sql => {
        db.query(sql, (err) => {
            if (err && err.errno !== 1060) console.log("LSAFHR Sync Note:", err.message);
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
            html: `<h2>Welcome to LSAFHR</h2><p>An identity has been initialized for you.</p><p><b>ID:</b> ${req.body.id}<br><b>System Key:</b> ${req.body.password}</p>`
        };
        transporter.sendMail(mailOptions);
        res.json({ success: true });
    });
});

app.put('/api/employees/:id', (req, res) => {
    const id = req.params.id;
    const { name, email, role, password, loan_opening_balance, leave_annual, leave_casual } = req.body;
    const sql = `UPDATE employees SET name=?, email=?, role=?, password=?, loan_opening_balance=?, leave_annual=?, leave_casual=? WHERE id=?`;
    db.query(sql, [name, email, role, password, loan_opening_balance, leave_annual, leave_casual, id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.delete('/api/employees/:id', (req, res) => {
    const id = req.params.id;
    db.query('DELETE FROM attendance WHERE employee_id = ?', [id], () => {
        db.query('DELETE FROM loans WHERE employee_id = ?', [id], () => {
            db.query('DELETE FROM leaves WHERE employee_id = ?', [id], () => {
                db.query('DELETE FROM employees WHERE id = ?', [id], (err) => res.json({ success: true }));
            });
        });
    });
});

// --- LEAVES HUB MODULE ---

app.get('/api/leaves/:id', (req, res) => {
    db.query('SELECT * FROM leaves WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, r) => res.json(r || []));
});

app.get('/api/admin/leaves', (req, res) => {
    const sql = `SELECT l.*, e.name, e.leave_annual, e.leave_casual FROM leaves l JOIN employees e ON l.employee_id = e.id ORDER BY l.id DESC`;
    db.query(sql, (err, r) => res.json(r || []));
});

app.put('/api/admin/leaves/:id', (req, res) => {
    const { status } = req.body;
    const leaveId = req.params.id;

    db.query('SELECT * FROM leaves WHERE id = ?', [leaveId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: "Request not found" });
        const leave = results[0];

        db.query('UPDATE leaves SET status = ? WHERE id = ?', [status, leaveId], (err) => {
            if (status === 'Approved') {
                const column = leave.leave_type === 'Annual Leave' ? 'leave_annual' : 'leave_casual';
                db.query(`UPDATE employees SET ${column} = ${column} - ? WHERE id = ?`, [leave.days, leave.employee_id]);
            }

            db.query('SELECT name, email, leave_annual, leave_casual FROM employees WHERE id = ?', [leave.employee_id], (err, empRes) => {
                if (!err && empRes.length > 0) {
                    const emp = empRes[0];
                    transporter.sendMail({
                        from: `"LSAFHR System"`, to: emp.email,
                        subject: `Leave Request Update: ${status}`,
                        html: `<p>Hello ${emp.name}, your request for ${leave.leave_type} has been <b>${status}</b>.</p>
                               <p>Remaining: ${emp.leave_annual} Annual / ${emp.leave_casual} WOP days.</p>`
                    });
                }
            });
            res.json({ success: true });
        });
    });
});

app.post('/api/leaves', (req, res) => {
    const { employeeId, type, startDate, days, reason } = req.body;
    db.query('INSERT INTO leaves (employee_id, leave_type, start_date, days, reason) VALUES (?, ?, ?, ?, ?)', [employeeId, type, startDate, days, reason], (err) => {
        const mailOptions = {
            from: `"LSAFHR System"`,
            to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
            subject: `Matrix Alert: New Leave Request (${employeeId})`,
            html: `<p>Staff <b>${employeeId}</b> has requested <b>${days} days</b> of <b>${type}</b>.</p>`
        };
        transporter.sendMail(mailOptions);
        res.json({ success: true });
    });
});

// --- LOAN HUB MODULE ---

app.get('/api/loans/:id', (req, res) => {
    db.query('SELECT * FROM loans WHERE employee_id = ? ORDER BY id DESC', [req.params.id], (err, r) => res.json(r || []));
});

app.get('/api/admin/loans', (req, res) => {
    db.query('SELECT l.*, e.name FROM loans l JOIN employees e ON l.employee_id = e.id ORDER BY l.id DESC', (err, r) => res.json(r || []));
});

app.put('/api/admin/loans/:id', (req, res) => {
    const { status } = req.body;
    db.query('UPDATE loans SET status = ? WHERE id = ?', [status, req.params.id], (err) => {
        db.query('SELECT l.employee_id, e.email, e.name, l.amount FROM loans l JOIN employees e ON l.employee_id = e.id WHERE l.id = ?', [req.params.id], (err, results) => {
            if (!err && results.length > 0) {
                const ln = results[0];
                transporter.sendMail({
                    from: `"LSAFHR System"`, to: ln.email,
                    subject: `Loan Request Update: ${status}`,
                    html: `<p>Hello ${ln.name}, your loan request for <b>Rs. ${ln.amount}</b> has been <b>${status}</b>.</p>`
                });
            }
        });
        res.json({ success: true });
    });
});

app.post('/api/loans', (req, res) => {
    const { employeeId, amount, reason } = req.body;
    db.query('INSERT INTO loans (employee_id, amount, reason) VALUES (?, ?, ?)', [employeeId, amount, reason], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        const mailOptions = {
            from: `"LSAFHR System"`,
            to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
            subject: `Matrix Alert: New Loan Request (${employeeId})`,
            html: `<p>Staff <b>${employeeId}</b> requested <b>Rs. ${amount}</b>.</p><p>Reason: ${reason}</p>`
        };
        transporter.sendMail(mailOptions);
        res.json({ success: true });
    });
});

// --- DISCUSSION BOARD ---

app.get('/api/discussions', (req, res) => {
    db.query('SELECT * FROM discussions ORDER BY id DESC LIMIT 50', (err, r) => res.json(r || []));
});

app.post('/api/discussions', (req, res) => {
    db.query('INSERT INTO discussions SET ?', req.body, (err) => {
        db.query('SELECT email FROM employees', (err, emps) => {
            if (!err) {
                const emails = emps.map(e => e.email).filter(e => e).join(',');
                if (emails) {
                    transporter.sendMail({
                        from: `"LSAFHR Board"`, to: emails,
                        subject: `New Board Broadcast`,
                        html: `<p><b>${req.body.author_name}:</b> ${req.body.message}</p>`
                    });
                }
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
