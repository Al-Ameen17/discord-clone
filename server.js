require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const app = express();
const http = require('http').createServer(app);

// FIX 1: Increase message size limit to 10MB for images
const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e8 // 100 MB
});

const bcrypt = require('bcryptjs'); 

app.use(express.static('public'));
app.use(express.json());

// --- 1. DEFINE MODELS FIRST (Critical Order Fix) ---
const Message = mongoose.model('Message', new mongoose.Schema({
    user: String,
    text: String,
    room: String,
    avatar: String,
    timestamp: { type: Date, default: Date.now },
    reactions: { type: Map, of: [String], default: {}}
}));

const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatar: { type: String } 
}));

const Room = mongoose.model('Room', new mongoose.Schema({
    name: { type: String, required: true, unique: true }
}));

// --- 2. CONNECT TO DB & SEED ROOMS ---
const mongoURI = process.env.MONGO_URI; 
mongoose.connect(mongoURI)
    .then(async () => {
        console.log('✅ Connected to MongoDB!');
        
        // Check if rooms exist, if not, create default
        const count = await Room.countDocuments();
        if (count === 0) {
            await new Room({ name: 'general' }).save();
            await new Room({ name: 'gaming' }).save();
            await new Room({ name: 'music' }).save();
            console.log("Created default rooms");
        }
    })
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 3. ROUTES ---
// Global set to track online users
const activeUsers = new Set();

app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ success: false, message: "Username taken" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${username}`;
        
        const newUser = new User({ username, password: hashedPassword, avatar });
        await newUser.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.status(400).json({ success: false, message: "Invalid credentials" });
        }
        if (!user.avatar) {
            user.avatar = `https://api.dicebear.com/7.x/notionists/svg?seed=${username}`;
            await user.save();
        }
        res.json({ success: true, username: user.username, avatar: user.avatar });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get('/rooms', async (req, res) => {
    const rooms = await Room.find();
    res.json(rooms);
});

app.post('/rooms', async (req, res) => {
    try {
        const { name } = req.body;
        if (!/^[a-z0-9]+$/i.test(name)) return res.status(400).json({success: false});
        const newRoom = new Room({ name });
        await newRoom.save();
        io.emit('new room', name);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ success: false });
    }
});

// --- 4. SOCKET IO ---
io.on('connection', (socket) => {
    let currentRoom = 'general';
    socket.join(currentRoom);

    // Load History
    Message.find({ room: currentRoom }).sort({ timestamp: 1 }).limit(50)
        .then(messages => socket.emit('load history', messages));

    // Join Room
    socket.on('join room', (newRoom) => {
        socket.leave(currentRoom);
        socket.join(newRoom);
        currentRoom = newRoom;
        
        Message.find({ room: newRoom }).sort({ timestamp: 1 }).limit(50)
            .then(messages => socket.emit('load history', messages));
            
        socket.emit('chat message', { user: 'System', text: `You joined #${newRoom}` });
    });

    // Chat Message
    socket.on('chat message', (msg) => {
        const newMessage = new Message({
            user: msg.user,
            text: msg.text,
            room: currentRoom,
            avatar: msg.avatar
        });

        newMessage.save().then((savedMessage) => {
            io.to(currentRoom).emit('chat message', savedMessage);

            // DEBUG: Print what room the server THINKS we are in
            console.log(`[DEBUG] Message sent in room: ${currentRoom}`);

            if (currentRoom.startsWith('dm_')) {
                const parts = currentRoom.split('_');
                const targetUser = parts.find(part => part !== 'dm' && part !== msg.user);
                
                if (targetUser) {
                    console.log(`🔔 RINGING BELL: Sending notification to notify_${targetUser}`);
                    io.to("notify_" + targetUser).emit('dm notification', { sender: msg.user });
                } else {
                    console.log(`[DEBUG] Could not find target user in ${currentRoom}`);
                }
            }
        });
    });

    socket.on('delete message', (messageId) => {
        Message.findByIdAndDelete(messageId).then(() => {
            io.emit('delete message', messageId);
        });
    });

    socket.on('typing', (data) => {
        socket.to(data.room).emit('display typing', data);
    });

    // FIX 3: Re-register user on connection
    socket.on('user joined', (username) => {
        socket.username = username; 
        activeUsers.add(username);
        socket.join("notify_" + username); // IMPORTANT: Join the notification channel
        console.log(`User ${username} joined notification channel`);
        io.emit('update user list', Array.from(activeUsers));
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            activeUsers.delete(socket.username);
            io.emit('update user list', Array.from(activeUsers));
        }
    });

    socket.on('add reaction', async ({ messageId, emoji, user }) => {
        try {
            const msg = await Message.findById(messageId);
            if (!msg) return;
            if (!msg.reactions) msg.reactions = new Map();

            let users = msg.reactions.get(emoji) || [];
            if (users.includes(user)) users = users.filter(u => u !== user);
            else users.push(user);

            msg.reactions.set(emoji, users);
            await msg.save();
            io.emit('update message', msg);
        } catch (err) { console.error(err); }
    });

    socket.on('request user list', () => {
        // Send the list ONLY to the person who asked (saves bandwidth)
        socket.emit('update user list', Array.from(activeUsers));
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});