const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));


const roomHistory = {
    'general': [],
    'gaming': [],
    'music': []
};

io.on('connection', (socket) => {
    console.log('A user connected!');
    
    //Set a default room for everyone ("general")
    let currentRoom = 'general';
    socket.join(currentRoom);

    //Send the history of 'general' immediately
    socket.emit('load history', roomHistory[currentRoom]);

    // Handle switching rooms
    socket.on('join room', (newRoom) => {
        socket.leave(currentRoom); // Leave the old room
        socket.join(newRoom);      // Join the new one
        currentRoom = newRoom;     // Update memory

        //When switching rooms, send the history of the NEW room
        if (roomHistory[newRoom]) {
            socket.emit('load history', roomHistory[newRoom]);
        }
        
        // Tell the user they switched
        socket.emit('chat message', { 
            user: 'System', 
            text: `You joined #${newRoom}` 
        });
    });

    socket.on('chat message', (msg) => {
        if (roomHistory[currentRoom]){
            roomHistory[currentRoom].push(msg);

            if (roomHistory[currentRoom].length > 50) {
                roomHistory[currentRoom].shift();
            }
        }

        io.to(currentRoom).emit('chat message', msg);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log(`Server running at ${PORT}`);
});