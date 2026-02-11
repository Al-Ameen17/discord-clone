require('dotenv').config(); // Load environment variables
const express = require('express');
const mongoose = require('mongoose'); // The database tool
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// 1. Connect to MongoDB
// use process.env.MONGO_URI so we don't expose the password in the code
const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI)
    .then(() => console.log('✅ Connected to MongoDB!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// 2. Define what a "Message" looks like
const messageSchema = new mongoose.Schema({
    user: String,
    text: String,
    room: String,
    timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

io.on('connection', (socket) => {
    console.log('A user connected!');
    
    // Default room
    let currentRoom = 'general';
    socket.join(currentRoom);

    // 3. Load History from Database (Last 50 messages)
    Message.find({ room: currentRoom }).sort({ timestamp: 1 }).limit(50)
        .then(messages => {
            socket.emit('load history', messages);
        });

    socket.on('join room', (newRoom) => {
        socket.leave(currentRoom);
        socket.join(newRoom);
        currentRoom = newRoom;
        
        // Load history for the NEW room
        Message.find({ room: newRoom }).sort({ timestamp: 1 }).limit(50)
            .then(messages => {
                socket.emit('load history', messages);
            });
            
        socket.emit('chat message', { 
            user: 'System', 
            text: `You joined #${newRoom}` 
        });
    });

    socket.on('chat message', (msg) => {
        // 4. Save the message to MongoDB
        const newMessage = new Message({
            user: msg.user,
            text: msg.text,
            room: currentRoom
        });

        newMessage.save().then(() => {
            // Once saved, send it to everyone in the room
            io.to(currentRoom).emit('chat message', msg);
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});