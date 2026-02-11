require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const bcrypt = require('bcryptjs'); // New security tool
const activeUsers = new Set();

app.use(express.static('public'));
app.use(express.json()); // Allows server to read JSON data sent from login page

const mongoURI = process.env.MONGO_URI; 
mongoose.connect(mongoURI)
    .then(() => console.log('✅ Connected to MongoDB!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 1. DATABSE MODELS ---
// Message Model (Keep this)
const Message = mongoose.model('Message', new mongoose.Schema({
    user: String,
    text: String,
    room: String,
    avatar: String,
    timestamp: { type: Date, default: Date.now }
}));

// User Model
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatar: { type: String } 
}));

// --- 2. AUTHENTICATION ROUTES ---
// Register Route (Generate avatar on sign-up)
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ success: false, message: "Username taken" });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // GENERATE AVATAR: distinct visual style based on username
        const avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${username}`;
        
        const newUser = new User({ username, password: hashedPassword, avatar });
        await newUser.save();
        
        res.json({ success: true, message: "User created!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error registering" });
    }
});

// Login Route (Send avatar to client)
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.status(400).json({ success: false, message: "Invalid credentials" });
        }

        // MIGRATION FIX: If old user has no avatar, give them one now
        if (!user.avatar) {
            user.avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${username}`;
            await user.save();
        }

        // Send both username AND avatar
        res.json({ success: true, username: user.username, avatar: user.avatar });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error logging in" });
    }
});

// --- 3. SOCKET IO (CHAT LOGIC) ---
io.on('connection', (socket) => {
    // Join Default Room
    let currentRoom = 'general';
    socket.join(currentRoom);

    // Load History
    Message.find({ room: currentRoom }).sort({ timestamp: 1 }).limit(50)
        .then(messages => socket.emit('load history', messages));

    // Handle Room Switching
    socket.on('join room', (newRoom) => {
        socket.leave(currentRoom);
        socket.join(newRoom);
        currentRoom = newRoom;
        
        Message.find({ room: newRoom }).sort({ timestamp: 1 }).limit(50)
            .then(messages => socket.emit('load history', messages));
            
        socket.emit('chat message', { 
            user: 'System', 
            text: `You joined #${newRoom}` 
        });
    });

    // Handle Chat Messages
    socket.on('chat message', (msg) => {
        const newMessage = new Message({
            user: msg.user,
            text: msg.text,
            room: currentRoom,
            avatar: msg.avatar
        });

        newMessage.save().then(() => {
            io.to(currentRoom).emit('chat message', msg);
        });
    });
    // Handle Message Deletion
    socket.on('delete message', (messageId) => {
        // 1. Delete from Database
        Message.findByIdAndDelete(messageId)
            .then(() => {
                // 2. Tell everyone to remove it from their screen
                io.emit('delete message', messageId);
            })
            .catch(err => console.error("Delete failed:", err));
    });
    // Handle Typing
    socket.on('typing', (data) => {
        // Broadcast to everyone in the room EXCEPT the sender
        socket.to(data.room).emit('display typing', data);
    });
    // User announces presence
    socket.on('user joined', (username) => {
    socket.username = username; // Attach name to this socket
    activeUsers.add(username);

    // Tell everyone the new list
    io.emit('update user list', Array.from(activeUsers));
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
    if (socket.username) {
        activeUsers.delete(socket.username);
        io.emit('update user list', Array.from(activeUsers));
    }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});