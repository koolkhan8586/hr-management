require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from the current directory (where index.html will be)
app.use(express.static(__dirname));

// 1. Database Connection
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', 
    database: process.env.DB_NAME || 'hr_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 2. Email Configuration (Nodemailer)
const transporter = nodemailer.createTransport({
    service: 'gmail', 
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

/**
 * Global Email Sender Helper
 */
const sendEmail = (to, subject, text) => {
    if (!to || !process.env.EMAIL_USER || !to.includes('@')) {
        console.log("Skipping email: Invalid recipient or missing server config.");
        return;
    }
    const mailOptions = { 
        from: `"LSAF-HR Portal" <${process.env.EMAIL_USER}>`, 
        to, 
        subject, 
        text 
    };
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) console.error('Error sending email:', error);
        else console.log('Email sent successfully to:', to);
    });
};

// --- API ROUTES ---

// Route to serve the main frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 1. Get All Employees
app.get('/api/employees', (req, res) => {
    db.query('SELECT * FROM employees', (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 2. Add/Edit Employee (Staff Hub)
app.post('/api/employees', (req, res) => {
    const { id, name, role, email, password, leave_annual, leave_casual } = req.body;
    const sql = `INSERT INTO employees (id, name, role, email, password, leave_annual, leave_casual) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.query(sql, [id, name, role, email, password, leave_annual, leave_casual], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.put('/api/employees/:id', (req, res) => {
    const { name, role, email, password, leave_annual, leave_casual, basic_salary, others_allowance, invigilation, increment, eidi, tax, loan_deduction, insurance } = req.body;
    const sql = `UPDATE employees SET name=?, role=?, email=?, password=?, leave_annual=?, leave_casual=?, basic_salary=?, others_allowance=?, invigilation=?, increment=?, eidi=?, tax=?, loan_deduction=?, insurance=? WHERE id=?`;
    db.query(sql, [name, role, email, password, leave_annual, leave_casual, basic_salary, others_allowance, invigilation, increment, eidi, tax, loan_deduction, insurance, req.params.id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 3. Attendance Logic (Enhanced for Exports)

// Admin View: Get ALL attendance records for all employees
app.get('/api/attendance', (req, res) => {
    const sql = `
        SELECT a.*, e.name as employee_name 
        FROM attendance a 
        JOIN employees e ON a.employee_id = e.id 
        ORDER BY a.date_str DESC, a.time_str DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// Record Attendance session
app.post('/api/attendance', (req, res) => {
    const { employeeId, type, date, time, lat, lng } = req.body;
    
    const sqlInsert = `INSERT INTO attendance (employee_id, type, date_str, time_str, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?)`;
    db.query(sqlInsert, [employeeId, type, date, time, lat, lng], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        // Email Trigger
        db.query('SELECT email, name FROM employees WHERE id = ?', [employeeId], (err, rows) => {
            if (!err && rows.length > 0 && rows[0].email) {
                const subject = `LSAF-HR: Attendance ${type} Notification`;
                const message = `Hello ${rows[0].name},\n\nThis is a confirmation that you have successfully logged a "${type}" at ${time} on ${date}.\n\nLocation: ${lat}, ${lng}.`;
                sendEmail(rows[0].email, subject, message);
            }
        });

        res.json({ message: 'Attendance logged' });
    });
});

// Specific Employee View (For self-export)
app.get('/api/attendance/:employeeId', (req, res) => {
    db.query(`SELECT * FROM attendance WHERE employee_id = ? ORDER BY date_str DESC, time_str DESC`, [req.params.employeeId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 4. Leave Management
app.post('/api/leaves', (req, res) => {
    const { employeeId, type, startDate, days, reason } = req.body;
    const sql = `INSERT INTO leaves (employee_id, leave_type, start_date, days, reason, status) VALUES (?, ?, ?, ?, ?, 'Pending')`;
    db.query(sql, [employeeId, type, startDate, days, reason], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/leaves/:employeeId', (req, res) => {
    db.query('SELECT * FROM leaves WHERE employee_id = ? ORDER BY start_date DESC', [req.params.employeeId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// 5. Discussion Board
app.get('/api/discussions', (req, res) => {
    db.query('SELECT * FROM discussions ORDER BY id DESC', (err, posts) => {
        if (err) return res.status(500).json({ error: err.message });
        db.query('SELECT * FROM replies ORDER BY date ASC', (err, replies) => {
            const data = (posts || []).map(p => ({
                ...p,
                replies: replies ? replies.filter(r => r.discussionId === p.id) : []
            }));
            res.json(data);
        });
    });
});

app.post('/api/discussions', (req, res) => {
    const { title, message, senderName, senderId, recipientId, date } = req.body;
    const sql = `INSERT INTO discussions (title, message, senderName, senderId, recipientId, date) VALUES (?, ?, ?, ?, ?, ?)`;
    db.query(sql, [title, message, senderName, senderId, recipientId, date], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// 6. Loans
app.get('/api/loans', (req, res) => {
    db.query(`SELECT l.*, e.name as employee_name FROM loans l JOIN employees e ON l.employee_id = e.id`, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
