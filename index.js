const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const PORT = process.env.PORT || 3001;
const path = require("path");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
let socketList = {};
let rooms = {};
let externalUsers = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, "../vite")));
app.use(cors("*"));
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));

  app.get("/*", function (req, res) {
    res.sendFile(path.join(__dirname, "../client/build/index.html"));
  });
}

// Route
app.get("/ping", (req, res) => {
  res.status(200).send({ success: true });
});

// function cleanupRoom(roomId) {
//   if (rooms[roomId] && rooms[roomId].size === 0) {
//     delete rooms[roomId];
//     console.log(`Room ${roomId} has been deleted due to inactivity`);
//   }
// }

// Socket
io.on("connection", (socket) => {
  console.log(`New User connected: ${socket.id}`);

  socket.on("disconnect", () => {
    delete socketList[socket.id];
    console.log("User disconnected!");
  });

  socket.on("BE-check-user", ({ roomId, userName }) => {
    let error = false;
    console.log("BE-check-user", roomId, userName);

    if (rooms[roomId] && rooms[roomId].has(userName)) {
      error = true;
    }

    socket.emit("FE-error-user-exist", { error });
  });

  socket.on("BE-join-room", ({ roomId, userName }) => {
    console.log("BE-join-room", roomId, userName);
    socket.join(roomId);
    socketList[socket.id] = { userName, video: true, audio: true };

    if (!rooms[roomId]) {
      rooms[roomId] = new Set();
    }
    rooms[roomId].add(userName);

    const users = Array.from(rooms[roomId]).map((user) => ({
      userId:
        Object.keys(socketList).find(
          (id) => socketList[id].userName === user
        ) || null,
      info: {
        userName: user,
        video:
          socketList[
            Object.keys(socketList).find(
              (id) => socketList[id].userName === user
            )
          ]?.video || true,
        audio:
          socketList[
            Object.keys(socketList).find(
              (id) => socketList[id].userName === user
            )
          ]?.audio || true,
      },
    }));

    socket.broadcast.to(roomId).emit("FE-user-join", users);
  });

  socket.on("BE-call-user", ({ userToCall, from, signal }) => {
    io.to(userToCall).emit("FE-receive-call", {
      signal,
      from,
      info: socketList[socket.id],
    });
  });

  socket.on("BE-accept-call", ({ signal, to }) => {
    io.to(to).emit("FE-call-accepted", {
      signal,
      answerId: socket.id,
    });
  });

  socket.on("BE-send-message", ({ roomId, msg, sender }) => {
    io.sockets.in(roomId).emit("FE-receive-message", { msg, sender });
  });

  socket.on("BE-leave-room", ({ roomId, leaver }) => {
    delete socketList[socket.id];
    socket.broadcast.to(roomId).emit("FE-user-leave", { userName: leaver });
    socket.leave(roomId);
    if (rooms[roomId]) {
      rooms[roomId].delete(leaver);
      // cleanupRoom(roomId);
    }
  });

  socket.on("BE-toggle-camera-audio", ({ roomId, switchTarget }) => {
    if (socketList[socket.id]) {
      if (switchTarget === "video") {
        socketList[socket.id].video = !socketList[socket.id].video;
      } else {
        socketList[socket.id].audio = !socketList[socket.id].audio;
      }
      socket.broadcast
        .to(roomId)
        .emit("FE-toggle-camera", { userId: socket.id, switchTarget });
    } else {
      console.log(`Socket ${socket.id} not found in socketList`);
      socket.emit("FE-error", { message: "User not found in room" });
    }
  });
});

// function cleanupRoom(roomId) {
//   if (rooms[roomId] && rooms[roomId].size === 0) {
//     delete rooms[roomId];
//     console.log(`Room ${roomId} has been deleted due to inactivity`);
//   }
// }
app.post("/api/create-room", (req, res) => {
  const roomId = uuidv4(); // Generate a unique room ID
  rooms[roomId] = new Set();
  console.log(`Room ${roomId} has been created via API`);
  res.status(201).json({ roomId });
});
app.post("/api/addUser", (req, res) => {
  const { roomId, userName } = req.body;

  if (!roomId || !userName) {
    return res.status(400).json({ error: "roomId and userName are required" });
  }

  if (!rooms[roomId]) {
    rooms[roomId] = new Set();
  }

  if (rooms[roomId].has(userName)) {
    return res.status(409).json({ error: "User already exists in the room" });
  }

  rooms[roomId].add(userName);

  // Store user info for external users
  if (!externalUsers[roomId]) {
    externalUsers[roomId] = {};
  }
  externalUsers[roomId][userName] = { video: true, audio: true };

  // Generate a unique token for the user
  const userToken = uuidv4();

  // Add the user to socketList (this wasn't in your original code)
  socketList[userToken] = { userName, video: true, audio: true };

  // Notify all clients in the room about the new user
  io.to(roomId).emit("FE-user-join", [
    {
      userId: userToken,
      info: {
        userName: userName,
        video: true,
        audio: true,
      },
    },
  ]);

  // Prepare the response with all necessary information
  const responseData = {
    success: true,
    message: "User added successfully",
    roomId: roomId,
    userName: userName,
    userToken: userToken,
    iframeUrl: `http://localhost:5173/room/${roomId}?userToken=${userToken}&userName=${encodeURIComponent(
      userName
    )}`,
    users: Array.from(rooms[roomId]).map((user) => ({
      userName: user,
      video: externalUsers[roomId][user]?.video || true,
      audio: externalUsers[roomId][user]?.audio || true,
    })),
  };

  // Save user session information (you might want to use a database for this in a production environment)
  if (!global.userSessions) {
    global.userSessions = {};
  }
  global.userSessions[userToken] = {
    roomId: roomId,
    userName: userName,
  };

  res.status(200).json(responseData);
});

// Update the removeUser API to handle external users
app.post("/api/removeUser", (req, res) => {
  const { roomId, userName } = req.body;

  if (!roomId || !userName) {
    return res.status(400).json({ error: "roomId and userName are required" });
  }

  if (!rooms[roomId] || !rooms[roomId].has(userName)) {
    return res.status(404).json({ error: "User not found in the room" });
  }

  rooms[roomId].delete(userName);

  // Remove user from externalUsers if present
  if (externalUsers[roomId] && externalUsers[roomId][userName]) {
    delete externalUsers[roomId][userName];
  }

  // Remove user from socketList
  const userToken = Object.keys(socketList).find(
    (token) => socketList[token].userName === userName
  );
  if (userToken) {
    delete socketList[userToken];
  }

  // Notify all clients in the room about the user leaving
  io.to(roomId).emit("FE-user-leave", { userName });

  res.status(200).json({ message: "User removed successfully" });
});

http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
