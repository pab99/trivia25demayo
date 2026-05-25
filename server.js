const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const preguntas = JSON.parse(fs.readFileSync(path.join(__dirname, 'preguntas.json'), 'utf8'));

let jugadores = {}; // { username: { username, puntos, vidas, respondidas: [], combo } }

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('join_game', (username) => {
        const cleanUsername = username.toLowerCase().replace('@', '').trim();
        
        jugadores[cleanUsername] = {
            username: cleanUsername,
            puntos: 0,
            vidas: 3,
            respondidas: [],
            combo: 0,
            socketId: socket.id
        };
        
        socket.usernameClean = cleanUsername;
        enviarRanking();
    });

    socket.on('get_pregunta', () => {
        const cleanUsername = socket.usernameClean;
        const jugador = jugadores[cleanUsername];
        if (!jugador) return;

        if (jugador.vidas <= 0) {
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_over', { puntos: jugador.puntos, puesto: puesto });
            return;
        }

        const disponibles = preguntas.filter(p => !jugador.respondidas.includes(p.id));
        if (disponibles.length === 0) {
            const puesto = obtenerPuesto(cleanUsername);
            socket.emit('game_completed', { puntos: jugador.puntos, puesto: puesto });
            return;
        }

        const pregunta = disponibles[Math.floor(Math.random() * disponibles.length)];
        const opciones = [pregunta.correcta, ...pregunta.incorrectas].sort(() => Math.random() - 0.5);

        socket.emit('pregunta_data', {
            id: pregunta.id,
            pregunta: pregunta.pregunta,
            opciones: opciones
        });
    });

    socket.on('enviar_respuesta', ({ preguntaId, respuesta, intento, tiempoEmpleado }) => {
        const cleanUsername = socket.usernameClean;
        const jugador = jugadores[cleanUsername];
        if (!jugador) return;

        const pregunta = preguntas.find(p => p.id === preguntaId);
        const esCorrecta = pregunta.correcta === respuesta;

        if (esCorrecta) {
            jugador.respondidas.push(preguntaId);
            jugador.combo += 1;

            let puntosBase = intento === 1 ? 10 : 5;
            let bonusTiempo = Math.max(0, Math.round(15 * Math.log(20 / (tiempoEmpleado + 1))));
            let puntosPregunta = puntosBase + bonusTiempo;

            let multiplicador = 1;
            if (jugador.combo === 3) multiplicador = 2;
            if (jugador.combo
