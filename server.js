const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb'); // Conector oficial de MongoDB

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PREGUNTAS_PATH = path.join(__dirname, 'preguntas.json');

// Cargar preguntas históricas de forma segura al arrancar
const preguntasTodo = JSON.parse(fs.readFileSync(PREGUNTAS_PATH, 'utf8'));

// CONFIGURACIÓN DE PERSISTENCIA (MongoDB Atlas)
const mongoUri = process.env.MONGO_URI; 
let dbCollection = null;
let jugadores = {}; // Se mantiene en memoria local para máxima velocidad de respuesta en el juego

// Función asíncrona para inicializar la conexión con la nube al arrancar
async function conectarBaseDeDatos() {
    if (!mongoUri) {
        console.log("⚠️ ALERTA: No se detectó la variable MONGO_URI en Render. El servidor funcionará de forma efímera en memoria.");
        return;
    }
    try {
        const client = new MongoClient(mongoUri);
        await client.connect();
        const db = client.db('trivia_mayo_db'); // Nombre de la base de datos en Atlas
        dbCollection = db.collection('ranking'); // Nombre de la colección (tabla)
        console.log("🚀 CONECTADO EXITOSAMENTE A MONGO DB ATLAS");

        // Recuperar todo el historial guardado en la nube y volcarlo a la memoria
        const historialNube = await dbCollection.find({}).toArray();
        historialNube.forEach(jugador => {
            // Normalización preventiva para asegurar que no falte ningún campo clave
            if (jugador.puntos === undefined) jugador.puntos = 0;
            if (jugador.puntosRondaActual === undefined) jugador.puntosRondaActual = 0;
            if (!jugador.respondidas) jugador.respondidas = [];
            
            jugadores[jugador.username] = jugador;
        });
        console.log(`📦 BBDD SINCRONIZADA. Usuarios recuperados desde la nube: ${Object.keys(jugadores).length}`);
    } catch (error) {
        console.error("❌ Error crítico al conectar a MongoDB Atlas:", error.message);
    }
}

// Inicializamos la conexión
conectarBaseDeDatos();

// Guarda o actualiza de forma asíncrona los datos de un jugador en la nube
async function guardarRankingEnNube(username) {
    if (dbCollection && jugadores[username]) {
        try {
            // Hacemos una copia limpia del objeto en memoria para la BBDD
            const datosJugador = { ...jugadores[username] };
            delete datosJugador._id; // Quitamos el ID de Mongo de la estructura por si existiera conflicto
            
            // Reemplaza o inserta (upsert) el registro buscando por el campo único username
            await dbCollection.updateOne(
                { username: username },
                { $set: datosJugador },
                { upsert: true }
            );
        } catch (err) {
            console.log(`❌ Error al sincronizar usuario @${username} con Atlas:`, err.message);
        }
    }
}

// Endpoint de emergencia por si requerís descargar un backup estático en JSON desde el Dashboard
app.get('/ranking_persistente.json', (req, res) => {
    let listaCompleta = Object.values(jugadores).sort((a, b) => b.puntos - a.puntos);
    res.json(listaCompleta);
});

// LOGICA CENTRAL DE COMUNICACIÓN EN VIVO (WebSockets)
io.on('connection', (socket) => {
    console.log('🔌 Nuevo cliente conectado:', socket.id);

    // Enviar el ranking actual ni bien se conecta cualquier pantalla
    let listaAlConectar = Object.values(jugadores).sort((a, b) => b.puntos - a.puntos);
    socket.emit('update_ranking', listaAlConectar);

    // Solicitud explícita de datos desde el Dashboard de control o Pantalla de TV
    socket.on('pedir_ranking_dashboard', () => {
        let listaCompleta = Object.values(jugadores).sort((a, b) => b.puntos - a.puntos);
        socket.emit('data_ranking_dashboard', listaCompleta);
    });

    // Acción cuando un jugador ingresa su nombre e inicia el juego
    socket.on('join_game', (username) => {
        const cleanUsername = username.toLowerCase().replace('@', '').trim();
        
        // Si el jugador ya existía en el historial global, reiniciamos sus valores de la ronda actual
        if (jugadores[cleanUsername]) {
            jugadores[cleanUsername].vidas = 3;
            jugadores[cleanUsername].respondidas = [];
            jugadores[cleanUsername].combo = 0;
            jugadores[cleanUsername].puntosRondaActual = 0; 
            jugadores[cleanUsername].socketId = socket.id;
        } else {
            // Si es un jugador completamente nuevo en el evento
            jugadores[cleanUsername] = {
                username: cleanUsername,
                puntos: 0, 
                puntosRondaActual: 0, 
                vidas: 3,
                respondidas: [],
                combo: 0,
                socketId: socket.id
            };
        }
        
        socket.usernameClean = cleanUsername;
        
        // Guardamos en la nube asíncronamente y distribuimos el ranking actualizado en vivo
        guardar
