require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer'); // <--- NEW LIBRARY
const path = require('path');
const fs = require('fs');
const app = express();
const http = require('http').createServer(app);
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: 'dt7hwh7yo', 
  api_key: '897683664172516', 
  api_secret: 'gdZAlOQtkiLH8Vu1PpvUl_YhofQ' 
});
// FIX 1: Increase message size limit to 10MB for images
const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e7 // Reduced to 10MB for memory safety
});

const bcrypt = require('bcryptjs'); 

app.use(express.static('public'));
app.use(express.json());

// --- MULTER SETUP (File Uploads) ---
// 1. Ensure upload directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// 2. Configure Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        // Create unique filename: user-timestamp.ext
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit per profile pic
});

// 3. Serve the 'uploads' folder publicly
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
    replyTo: {
        id: String,
        user: String, 
        text: String
    }
}));

const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatar: { type: String },
    bio: { type: String, default: "Hi, I'm new to DihCord!" },
    status: { type: String, default: "Online" } //online, idle, dnd, invisible
}));

const Room = mongoose.model('Room', new mongoose.Schema({
    name: { type: String, required: true, unique: true }
}));

// --- DB CONNECTION ---
const mongoURI = process.env.MONGO_URI; 
mongoose.connect(mongoURI)
    .then(async () => {
        console.log('✅ Connected to MongoDB!');
        const count = await Room.countDocuments();
        if (count === 0) {
            await new Room({ name: 'general' }).save();
            await new Room({ name: 'gaming' }).save();
            await new Room({ name: 'music' }).save();
            console.log("Created default rooms");
        }
    })
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- ROUTES ---
const activeUsers = new Set();

// --- CLOUD UPLOAD ---
app.post('/upload-avatar', upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        // 1. Upload the local file to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: "dihcord_avatars", // Folder name in Cloudinary
            width: 300,               // Resize to save bandwidth
            height: 300,
            crop: "fill"
        });

        // 2. Delete the local file from 'uploads/' (keep server clean)
        fs.unlinkSync(req.file.path);

        // 3. Return the PERMANENT Cloud URL
        res.json({ success: true, filePath: result.secure_url });

    } catch (err) {
        console.error("Cloudinary Error:", err);
        res.status(500).json({ success: false, message: "Upload failed" });
    }
});

app.post('/register', async (req, res) => {
    try {
        const { username, password, avatar } = req.body; // <--- Now accepts custom avatar URL
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ success: false, message: "Username taken" });

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Use provided avatar OR fallback to DiceBear
        const finalAvatar = avatar || `https://api.dicebear.com/7.x/notionists/svg?seed=${username}`;
        
        const newUser = new User({ username, password: hashedPassword, avatar: finalAvatar });
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

// Update User Avatar Route
app.post('/update-user-avatar', async (req, res) => {
    try {
        const { username, avatarUrl } = req.body;
        await User.findOneAndUpdate({ username }, { avatar: avatarUrl });
        
        // Also update past messages so the chat history looks fresh
        await Message.updateMany({ user: username }, { avatar: avatarUrl });
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// Get User Profile (Public)
app.post('/get-profile', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });
        if (!user) return res.json({ success: false });
        res.json({ 
            success: true, 
            username: user.username, 
            avatar: user.avatar, 
            bio: user.bio, 
            status: user.status 
        });
    } catch (err) { res.status(500).json({ success: false }); }
});

// Update My Profile
app.post('/update-profile', async (req, res) => {
    try {
        const { username, bio, status } = req.body;
        await User.findOneAndUpdate({ username }, { bio, status });
        
        // Notify everyone that this user changed (so the UI updates instantly)
        io.emit('status update', { username, status });
        
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

// --- SOCKET IO ---
io.on('connection', (socket) => {
    let currentRoom = 'general';
    socket.join(currentRoom);

    // Limit history to 20 for memory safety
    Message.find({ room: currentRoom }).sort({ timestamp: -1 }).limit(20)
        .then(messages => socket.emit('load history', messages.reverse()));

    socket.on('join room', (newRoom) => {
        socket.leave(currentRoom);
        socket.join(newRoom);
        currentRoom = newRoom;
        
       Message.find({ room: newRoom }).sort({ timestamp: -1 }).limit(20)
            .then(messages => socket.emit('load history', messages.reverse()));
            
        socket.emit('chat message', { user: 'System', text: `You joined #${newRoom}` });
    });

    socket.on('chat message', (msg) => {
        const newMessage = new Message({
            user: msg.user,
            text: msg.text,
            room: currentRoom,
            avatar: msg.avatar,
            replyTo: msg.replyTo
        });

        newMessage.save().then((savedMessage) => {
            io.to(currentRoom).emit('chat message', savedMessage);
            
            // Notifications logic
            if (currentRoom.startsWith('dm_')) {
                const parts = currentRoom.split('_');
                const targetUser = parts.find(part => part !== 'dm' && part !== msg.user);
                if (targetUser) {
                    io.to("notify_" + targetUser).emit('dm notification', { sender: msg.user });
                }
            }
        });
    });
 
    socket.on('typing', (data) => {
        socket.to(data.room).emit('display typing', data);
    });

    socket.on('user joined', async (username) => {
        socket.username = username; 
        activeUsers.add(username);
        socket.join("notify_" + username);

        // NEW: Fetch status from DB to broadcast correctly
        const user = await User.findOne({ username });
        const status = user ? user.status : 'online';
        
        io.emit('status update', { username, status }); // Tell everyone I'm here
        io.emit('update user list', Array.from(activeUsers));
    });
  
    // Atomic Reaction Handling
    socket.on('add reaction', async ({ messageId, emoji, user }) => {
        try {
            const reactionPath = `reactions.${emoji}`;
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
                msg.text = newText;
                msg.edited = true;
                await msg.save();
                io.emit('update message', msg);
            }
        } catch (err) { console.error(err); }
    });

    // --- VOICE CHAT LOGIC ---
    socket.on('join-voice', (roomId, userId) => {
        socket.join(roomId); // Join a specific socket room for voice signaling
        socket.to(roomId).emit('user-connected-voice', userId); // Tell everyone else "Hey, UserID is here!"

        socket.on('disconnect', () => {
            socket.to(roomId).emit('user-disconnected-voice', userId);
        });
        
        // Handle explicit leave (hanging up)
        socket.on('leave-voice', (roomId, userId) => {
             socket.to(roomId).emit('user-disconnected-voice', userId);
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