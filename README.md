# 💬 DihCord v2.0

![Version](https://img.shields.io/badge/version-2.0.0-blue?style=for-the-badge)
![Status](https://img.shields.io/badge/status-live-success?style=for-the-badge&color=23a559)
![License](https://img.shields.io/badge/license-MIT-purple?style=for-the-badge)

A secure, full-stack, real-time communication platform inspired by Discord. Built with **Node.js**, **Socket.io**, and **WebRTC**, featuring persistent message history, media uploads, and live voice channels.

🔗 **[Live Demo](https://discord-clone-rmfb.onrender.com/)** *(Note: Hosted on Render Free Tier. Please allow up to 50s for the server to wake up.)*

---

## ✨ Key Features

### 🛡️ Security (New in v2.0)
* **JWT Authentication:** Stateless, secure session management using JSON Web Tokens.
* **XSS Sanitization:** All user inputs (messages, room names) are sanitized to prevent Cross-Site Scripting attacks.
* **Rate Limiting:** Protects against brute-force attacks and spam on API routes.
* **Header Security:** Implements `helmet` for secure HTTP headers.
* **Secure Sockets:** Socket connections require a valid JWT handshake.

### 🚀 Core Functionality
* **⚡ Real-Time Messaging:** Instant message delivery with typing indicators.
* **🎙️ Voice Chat:** Live, low-latency voice channels using **PeerJS (WebRTC)**.
* **☁️ Cloud Storage:** Secure, permanent image uploads (Avatars & Media) via **Cloudinary**.
* **💾 Persistent History:** Messages and users are stored in **MongoDB Atlas**.
* **🎨 Modern UI:** "Midnight Violet" theme with a responsive sidebar, mobile support, and glassmorphism elements.
* **DG Social Features:** Custom Avatars, Bios, Status Indicators (Online/Idle/DND), and Profile Cards.

---

## 🛠️ Tech Stack

**Frontend:**
* HTML5 / CSS3 (Custom Design)
* Vanilla JavaScript (ES6+)
* **PeerJS** (WebRTC Wrapper)

**Backend:**
* **Node.js** & **Express**
* **Socket.io** (Real-time Websockets)
* **Multer** (File Handling)
* **Helmet** & **Express-Rate-Limit** (Security)

**Database & Auth:**
* **MongoDB Atlas** (NoSQL Database)
* **Mongoose** (ODM)
* **Cloudinary** (Image CDN)
* **JWT** (JSON Web Tokens) & **Bcryptjs**

---

## 📸 Screenshots

Login

<img width="556" height="590" alt="Screenshot 2026-02-14 071708" src="https://github.com/user-attachments/assets/8c7e7ff8-a430-4e10-995d-5eb1eea686dc" />

Chat

<img width="1854" height="993" alt="Screenshot 2026-02-14 070951" src="https://github.com/user-attachments/assets/38214d2d-6f5a-4a64-b1fd-45eaf6ee88dd" />

Voice

<img width="543" height="502" alt="Screenshot 2026-02-14 071011" src="https://github.com/user-attachments/assets/f76e556e-d415-459b-b43e-192015225f97" />

Profile

<img width="527" height="514" alt="Screenshot 2026-02-14 071038" src="https://github.com/user-attachments/assets/073db643-527c-493d-bb87-c8b5450bae2c" />


🚀 Local Installation

1. Clone the repository
Bash
git clone [https://github.com/Al-Ameen17/dihcord.git](https://github.com/Al-Ameen17/dihcord.git)
cd dihcord

2. Install Dependencies
Bash
npm install

3. Configure Environment
Create a .env file in the root directory. You will need a MongoDB Atlas account and a Cloudinary account.

.env Content:

Code snippet
# Database Connection
MONGO_URI=your_mongodb_connection_string

# Security Secret (Generate a long random string)
JWT_SECRET=your_super_secret_key_here

# Cloudinary Credentials (for Image Storage)
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

4. Run the Server
Bash
npm start
The app will be running at http://localhost:3000.

🔮 Future Roadmap
[ ] Direct Messages (1-on-1 private rooms)

[ ] Screen Sharing in Voice Channels

[ ] Markdown support for text formatting

[ ] Multiple servers/guilds

[ ] Push Notifications

Made with ❤️ by Al-ameen Adeyinka Agbaje
