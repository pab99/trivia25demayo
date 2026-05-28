const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// 1. Conexión MongoDB blindada
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Conectado a MongoDB"))
    .catch(err => console.error("❌ ERROR CONEXIÓN MONGODB:", err));

// 2. Esquema y Modelo (asegurando el nombre de la colección)
const JugadorSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    puntos: Number,
    puntosRondaActual: Number,
    vidas: Number,
    respondidas: Array,
    combo: Number,
    socketId: String,
    hora: String
}, { collection: 'ranking'
