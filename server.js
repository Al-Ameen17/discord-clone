require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const http = require('http').createServer(app);
const cloudinary = require('cloudinary').v2;
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');        // <--- NEW: Auth Tokens
const xss = require('xss');                 // <--- NEW: Anti-Hacking (Cross Site Scripting)
const rateLimit = require('express-rate-limit'); // <--- NEW: Anti-Spam
const helmet = require('helmet');           // <--- NEW: Header Security

// --- SECURITY CONFIG ---
app.use(helmet({
    contentSecurityPolicy: false, // Disabled for simplicity with external scripts (PeerJS/Socket.io)
}));

// Rate Limiting (Max 100 requests per 15 mins per IP)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100,
    message: "Too many requests from this IP, please try again later."
});
app.use('/login', limiter);
app.use('/register', limiter);

// Cloudinary Config (From Environment Variables)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET 
});

const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e7 
});

app.use(express.static('public'));
app.use(express.json());

// --- MIDDLEWARE: VERIFY TOKEN ---
// This acts as a gatekeeper for protected routes
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.sendStatus(401); // No token? Get out.

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Invalid token? Forbidden.
        req.user = user; // Attach user info (username) to the request
        next();
    });
}

// --- MULTER SETUP ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });
app.use('/uploads', express.static('uploads'));

// --- MODELS ---
const Message = mongoose.model('Message', new mongoose.Schema({
    user: String,
    text: String,
    room: String,
    avatar: String,
    timestamp: { type: Date, default: Date.now },
    reactions: { type: Map, of: [String], default: {}},
    edited: { type:Boolean, default: false },
    replyTo: { id: String, user: String, text: String }
}));

const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatar: { type: String },
    bio: { type: String, default: "Hi, I'm new to DihCord!" },
    status: { type: String, default: "online" }
}));

const Room = mongoose.model('Room', new mongoose.Schema({
    name: { type: String, required: true, unique: true }
}));

// --- DB CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('✅ Connected to MongoDB!');
        if (await Room.countDocuments() === 0) {
            await new Room({ name: 'general' }).save();
            await new Room({ name: 'gaming' }).save();
            await new Room({ name: 'music' }).save();
        }
    })
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- ROUTES ---
const activeUsers = new Set();

// 1. PUBLIC ROUTES (Login/Register)
app.post('/register', async (req, res) => {
    try {
        const { username, password, avatar } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, message: "Missing fields" });

        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ success: false, message: "Username taken" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const finalAvatar = avatar || `https://api.dicebear.com/7.x/notionists/svg?seed=${username}`;
        
        const newUser = new User({ username, password: hashedPassword, avatar: finalAvatar });
        await newUser.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        
        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.status(400).json({ success: false, message: "Invalid credentials" });
        }

        // ISSUE JWT TOKEN
        const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });

        res.json({ success: true, username: user.username, avatar: user.avatar, token });
    } catch (err) { res.status(500).json({ success: false }); }
});

// 2. PROTECTED ROUTES (Require Token)
app.post('/upload-avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: "dihcord_avatars",
            width: 300, height: 300, crop: "fill"
        });
        fs.unlinkSync(req.file.path);
        res.json({ success: true, filePath: result.secure_url });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/update-user-avatar', authenticateToken, async (req, res) => {
    try {
        const { avatarUrl } = req.body;
        // SECURITY FIX: Use req.user.username (from token), ignore req.body.username
        const username = req.user.username; 

        await User.findOneAndUpdate({ username }, { avatar: avatarUrl });
        await Message.updateMany({ user: username }, { avatar: avatarUrl });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/get-profile', authenticateToken, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });
        if (!user) return res.json({ success: false });
        res.json({ success: true, username: user.username, avatar: user.avatar, bio: user.bio, status: user.status });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/update-profile', authenticateToken, async (req, res) => {
    try {
        const { bio, status } = req.body;
        const username = req.user.username; // SECURITY FIX: Trust token only
        
        await User.findOneAndUpdate({ username }, { bio, status });
        io.emit('status update', { username, status });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/rooms', authenticateToken, async (req, res) => {
    const rooms = await Room.find();
    res.json(rooms);
});

app.post('/rooms', authenticateToken, async (req, res) => {
    try {
        const { name } = req.body;
        // sanitize room name
        const cleanName = xss(name);
        if (!/^[a-z0-9]+$/i.test(cleanName)) return res.status(400).json({success: false});
        
        const newRoom = new Room({ name: cleanName });
        await newRoom.save();
        io.emit('new room', cleanName);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false }); }
});

// --- SOCKET IO SECURITY MIDDLEWARE ---
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Authentication error"));

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error("Authentication error"));
        socket.username = decoded.username; // Bind verified username to socket
        next();
    });
});

io.on('connection', (socket) => {
    let currentRoom = 'general';
    socket.join(currentRoom);

    // Initial Load
    Message.find({ room: currentRoom }).sort({ timestamp: -1 }).limit(20)
        .then(messages => socket.emit('load history', messages.reverse()));

    socket.emit('user joined', socket.username); // Use trusted username

    socket.on('join room', (newRoom) => {
        socket.leave(currentRoom);
        socket.join(newRoom);
        currentRoom = newRoom;
        Message.find({ room: newRoom }).sort({ timestamp: -1 }).limit(20)
            .then(messages => socket.emit('load history', messages.reverse()));
        socket.emit('chat message', { user: 'System', text: `You joined #${newRoom}` });
    });

    socket.on('chat message', (msg) => {
        // SECURITY FIX: Sanitize input
        const cleanText = xss(msg.text); 
        
        // SECURITY FIX: Use socket.username (trusted), not msg.user (untrusted)
        const newMessage = new Message({
            user: socket.username,
            text: cleanText,
            room: currentRoom,
            avatar: msg.avatar, // We still trust client avatar URL for now, but could fetch from DB
            replyTo: msg.replyTo
        });

        newMessage.save().then((savedMessage) => {
            io.to(currentRoom).emit('chat message', savedMessage);
            
            // Notifications
            if (currentRoom.startsWith('dm_')) {
                const parts = currentRoom.split('_');
                const targetUser = parts.find(part => part !== 'dm' && part !== socket.username);
                if (targetUser) {
                    io.to("notify_" + targetUser).emit('dm notification', { sender: socket.username });
                }
            }
        });
    });
 
    socket.on('typing', (data) => {
        socket.to(data.room).emit('display typing', { user: socket.username, room: data.room });
    });

    socket.on('user joined', async () => {
        // We ignore the username sent by client, use socket.username
        const username = socket.username;
        activeUsers.add(username);
        socket.join("notify_" + username);

        const user = await User.findOne({ username });
        const status = user ? user.status : 'online';
        
        io.emit('status update', { username, status });
        io.emit('update user list', Array.from(activeUsers));
    });

    socket.on('add reaction', async ({WKmessageId, emoji}) => {
         // ... (Reaction logic same, but use socket.username)
         // For brevity, using your existing logic but ensuring user comes from socket
         try {
            const reactionPath = `reactions.${emoji}`;
            const user = socket.username;
            let msg = await Message.findOneAndUpdate(
                { _id: messageId, [reactionPath]: user },
                { $pull: { [reactionPath]: user } },
                { returnDocument: 'after' }
            );
            if (!msg) {
                msg = await Message.findByIdAndUpdate(
                    messageId,
                    { $addToSet: { [reactionPath]: user } },
                    { returnDocument: 'after' }
                );
            }
            if (msg) io.emit('update message', msg);
        } catch (err) { console.error("Reaction Error:", err); }
    });

    socket.on('request user list', () => {
        socket.emit('update user list', Array.from(activeUsers));
    });

    socket.on('delete message', async (messageId) => {
        try {
            const msg = await Message.findById(messageId);
            if (!msg) return;
            // Only allow if it's the author (checked against trusted socket.username)
            if (msg.user === socket.username || socket.username === 'Sergslow') {
                await Message.findByIdAndDelete(messageId);
                io.emit('delete message', messageId);
            }
        } catch (err) { console.error(err); }
    });

    socket.on('edit message', async ({ id, newText }) => {
        try {
            const msg = await Message.findById(id);
            if (!msg) return;
            if (msg.user === socket.username) {
                msg.text = xss(newText); // Sanitize edit
                msg.edited = true;
                await msg.save();
                io.emit('update message', msg);
            }
        } catch (err) { console.error(err); }
    });

    // Voice Chat
    socket.on('join-voice', (roomId, peerId) => {
        socket.join(roomId);
        // Broadcast the peerId, but we know who SENT it (socket.username)
        socket.to(roomId).emit('user-connected-voice', peerId); 
        
        socket.on('disconnect', () => {
            socket.to(roomId).emit('user-disconnected-voice', peerId);
        });
        socket.on('leave-voice', () => {
             socket.to(roomId).emit('user-disconnected-voice', peerId);
        });
    });

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