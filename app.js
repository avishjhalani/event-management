require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const session = require('express-session');

const Event = require('./models/Event');
const Registration = require('./models/Registration');

const app = express();
const PORT = 3001;

const ADMIN = {
    username: 'admin',
    password: '1234'
};

// MongoDB connection with error handling
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
      console.error("❌ MongoDB connection error:", err);
      process.exit(1);  // Exit process on MongoDB connection error
  });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

// Home Page
app.get('/', async (req, res) => {
    try {
        const events = await Event.find();
        res.render('index', { events });
    } catch (err) {
        console.error('Error fetching events:', err);  // Log the full error
        res.status(500).send('Error fetching events: ' + err.message);  // Send detailed error to client
    }
});


// Events Page
app.get('/events', async (req, res) => {
    try {
        const events = await Event.find();
        const registrations = await Registration.find();

        const topEvents = events.map(event => ({
            title: event.title,
            date: event.date,
            registrationCount: registrations.filter(r => r.eventName === event.title).length
        }))
        .sort((a, b) => b.registrationCount - a.registrationCount)
        .slice(0, 5);

        res.render('events', { events, topEvents });
    } catch (err) {
        console.error('Error fetching events and registrations:', err);
        res.status(500).send('Error fetching events and registrations');
    }
});

// Register Route
app.post('/register', async (req, res) => {
    try {
        const { name, eventName } = req.body;
        const event = await Event.findOne({ title: eventName });
        if (!event) return res.send("Event not found.");

        const entryCode = crypto.randomBytes(4).toString('hex').toUpperCase();
        const confirmedCount = await Registration.countDocuments({ eventName, status: "Confirmed" });

        let status = confirmedCount < event.seats ? "Confirmed" : "Waiting List";
        const registration = new Registration({ name, eventName, entryCode, status });
        await registration.save();

        const qrData = `${name} | ${eventName} | ${entryCode} | ${status}`;
        const qrImage = await QRCode.toDataURL(qrData);

        res.render('success', { registration, qrImage });
    } catch (err) {
        console.error('Error during registration:', err);
        res.status(500).send('Error during registration');
    }
});

// Admin Login
app.get('/login', (req, res) => {
    res.render('login', { error: null, isSetup: ADMIN !== null });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN.username && password === ADMIN.password) {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        res.render('login', { error: 'Invalid credentials', isSetup: true });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// Admin Panel
app.get('/admin', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/login');
    try {
        const events = await Event.find();
        const registrations = await Registration.find();

        const eventMap = {};
        events.forEach(event => {
            eventMap[event.title] = { confirmed: [], waiting: [] };
        });

        registrations.forEach(reg => {
            if (eventMap[reg.eventName]) {
                eventMap[reg.eventName][reg.status === "Confirmed" ? "confirmed" : "waiting"].push(reg);
            }
        });

        res.render('admin', { events, eventMap, registrations });
    } catch (err) {
        console.error('Error fetching events and registrations for admin:', err);
        res.status(500).send('Error fetching events and registrations');
    }
});

// Add Event
app.post('/admin', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/login');
    try {
        const { title, date, seats } = req.body;
        await new Event({ title, date, seats: parseInt(seats) }).save();
        res.redirect('/admin');
    } catch (err) {
        console.error('Error adding event:', err);
        res.status(500).send('Error adding event');
    }
});

// Remove Candidate and Promote from Waiting
app.post('/admin/remove', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/login');
    try {
        const { entryCode } = req.body;
        const regToRemove = await Registration.findOneAndDelete({ entryCode });
        if (!regToRemove) return res.redirect('/admin');

        if (regToRemove.status === "Confirmed") {
            const promote = await Registration.findOne({ eventName: regToRemove.eventName, status: "Waiting List" });
            if (promote) {
                promote.status = "Confirmed";
                await promote.save();
            }
        }

        res.redirect('/admin');
    } catch (err) {
        console.error('Error removing candidate and promoting:', err);
        res.status(500).send('Error removing candidate');
    }
});

// Clear Waiting List
app.post('/admin/clear-waiting', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/login');
    try {
        const { eventTitle } = req.body;
        await Registration.deleteMany({ eventName: eventTitle, status: "Waiting List" });
        res.redirect('/admin');
    } catch (err) {
        console.error('Error clearing waiting list:', err);
        res.status(500).send('Error clearing waiting list');
    }
});

// Candidate Withdrawal
app.get('/withdraw', (req, res) => {
    res.render('withdraw', { message: null });
});

app.post('/withdraw', async (req, res) => {
    try {
        const { entryCode } = req.body;
        const regToRemove = await Registration.findOneAndDelete({ entryCode });
        if (!regToRemove) return res.render('withdraw', { message: 'Entry code not found.' });

        if (regToRemove.status === "Confirmed") {
            const promote = await Registration.findOne({ eventName: regToRemove.eventName, status: "Waiting List" });
            if (promote) {
                promote.status = "Confirmed";
                await promote.save();
            }
        }

        res.render('withdraw', { message: 'Registration withdrawn successfully.' });
    } catch (err) {
        console.error('Error during withdrawal:', err);
        res.status(500).send('Error during withdrawal');
    }
});

// About
app.get('/about', (req, res) => {
    res.render('about');
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
