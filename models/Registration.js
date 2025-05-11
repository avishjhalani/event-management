const mongoose = require('mongoose');

const registrationSchema = new mongoose.Schema({
    name: { type: String, required: true },
    eventName: { type: String, required: true },
    entryCode: { type: String, required: true, unique: true },
    status: { type: String, enum: ['Confirmed', 'Waiting List'], required: true }
});

module.exports = mongoose.model('Registration', registrationSchema);
