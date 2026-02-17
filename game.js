const grid = document.getElementById("pokemonGrid");
const selectedPokemonCard = document.getElementById("selectedPokemonCard");
const statusText = document.getElementById("statusText");
const hostIdDisplay = document.getElementById("hostIdDisplay");
const btnMakeGuess = document.getElementById("btnMakeGuess");

// Q&A Elements
const qaControls = document.getElementById("qa-controls");
const questionTypeSelect = document.getElementById("questionTypeSelect");
const questionValueSelect = document.getElementById("questionValueSelect");
const btnAskQuestion = document.getElementById("btnAskQuestion");

// Chat Elements
const chatContainer = document.getElementById("chat-container");
const chatHistory = document.getElementById("chatHistory");
const chatInput = document.getElementById("chatInput");
const btnSendChat = document.getElementById("btnSendChat");

// Modals
const answerModal = document.getElementById("answerModal");
const modalQuestionText = document.getElementById("modalQuestionText");
const btnAnswerYes = document.getElementById("btnAnswerYes");
const btnAnswerNo = document.getElementById("btnAnswerNo");

const guessModal = document.getElementById("guessModal");
const guessPokemonSelect = document.getElementById("guessPokemonSelect");
const btnConfirmGuess = document.getElementById("btnConfirmGuess");
const btnCancelGuess = document.getElementById("btnCancelGuess");

const waitingModal = document.getElementById("waitingModal");
const waitingHostId = document.getElementById("waitingHostId");
const btnCancelHost = document.getElementById("btnCancelHost");

let allPokemonNames = [];
let currentSeed = null;
let gameState = "SELECTING"; // 'SELECTING' | 'PLAYING' | 'WAITING_OPPONENT' | 'FINISHED'
let peer = null;
let conn = null;
let myPeerId = null;
let isHost = false;
let isOpponentReady = false;
let isMyTurn = false;
let canAsk = false;

// Seeded Random Generator (Mulberry32)
function mulberry32(a) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// Fetch all pokemon names only once
async function fetchPokemonData() {
    try {
        const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=150'); // Limit to Gen 1 for simplicity? Or 1000.
        const data = await response.json();
        allPokemonNames = data.results.map(p => p.name);

        // Start Initialization Loop
        init();

    } catch (error) {
        console.error("Error fetching Pokemon:", error);
        alert("Error cargando Pokémon. Intenta recargar.");
    }
}

function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const role = urlParams.get('role');
    const joinId = urlParams.get('id');

    if (role === 'single') {
        initGame(Math.floor(Math.random() * 1000000));
        statusText.textContent = "Modo: Un Jugador";
        gameState = "SELECTING"; /* Logic for single player needs work or just selecting */
        // For now, Single player just means you pick and that's it.
    } else if (role === 'host') {
        isHost = true;
        initPeer(null); // Init as host
    } else if (role === 'join' && joinId) {
        isHost = false;
        initPeer(joinId); // Init and connect
    } else {
        alert("Modo de juego inválido");
        window.location.href = 'index.html';
    }
}

function initPeer(destId) {
    peer = new Peer();

    peer.on('open', (id) => {
        myPeerId = id;
        console.log('My ID: ' + id);

        if (isHost) {
            showWaitingModal();
        } else if (destId) {
            connectToPeer(destId);
        }
    });

    peer.on('connection', (c) => {
        if (conn) { c.close(); return; }
        conn = c;
        setupConnection();
        // If host, hide waiting modal
        if (isHost) {
            waitingModal.style.display = 'none';
            statusText.textContent = "¡Conectado con Jugador!";
        }
    });

    peer.on('error', (err) => {
        console.error(err);
        alert("Error de conexión: " + err.type);
    });
}

function showWaitingModal() {
    waitingModal.style.display = 'flex';
    waitingHostId.textContent = myPeerId;
    waitingHostId.onclick = () => {
        navigator.clipboard.writeText(myPeerId);
        alert("¡Copiado!");
    };
}

btnCancelHost.onclick = () => {
    window.location.href = 'index.html';
};

function connectToPeer(destId) {
    statusText.textContent = "Conectando a " + destId + "...";
    conn = peer.connect(destId);
    setupConnection();
}

function setupConnection() {
    conn.on('open', () => {
        statusText.textContent = "¡Conectado!";
        chatContainer.style.display = 'flex';
        qaControls.style.display = 'block';

        if (isHost) {
            // Generate seed and send
            const seed = Math.floor(Math.random() * 1000000);
            initGame(seed);
            conn.send({ type: 'SEED', value: seed });
        }
    });

    conn.on('data', (data) => handleData(data));

    conn.on('close', () => {
        alert("¡Conexión Perdida!");
        window.location.href = 'index.html';
    });
}

function handleData(data) {
    if (data.type === 'SEED') {
        initGame(data.value);
    }
    if (data.type === 'CHAT') {
        appendChatMessage("Oponente", data.message);
    }
    if (data.type === 'READY') {
        isOpponentReady = true;
        appendChatMessage("Sistema", "¡El oponente está listo!");
        if (gameState === "PLAYING") {
            startMultiplayerGame();
        }
    }
    if (data.type === 'QUESTION') {
        showAnswerModal(data.text);
        appendChatMessage("Oponente", "Preguntó: " + data.text);
    }
    if (data.type === 'ANSWER') {
        appendChatMessage("Oponente", "Respondió: " + data.response + " (a: " + data.originalQuestion + ")");
        endTurn();
    }
    if (data.type === 'TURN_PASS') {
        isMyTurn = true;
        canAsk = true;
        enableAskControls();
        appendChatMessage("Sistema", "¡Tu Turno!");
    }
    if (data.type === 'GUESS') {
        handleOpponentGuess(data.pokemon);
    }
    if (data.type === 'CORRECT_GUESS') {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        setTimeout(() => alert("¡GANASTE! ¡Adivinaste correctamente!"), 500);
        gameState = "FINISHED";
    }
    if (data.type === 'LOSE') {
        appendChatMessage("Sistema", "Tu respuesta " + data.pokemon + " fue INCORRECTA. Cambio de turno.");
        endTurn();
    }
}

function initGame(seed) {
    currentSeed = seed;
    // statusText.textContent += ` (Seed: ${seed})`; 
    gameState = "SELECTING";
    selectedPokemonCard.innerHTML = '<div class="placeholder-text">?</div>';
    selectedPokemonCard.className = "card placeholder-card";

    const rng = mulberry32(seed);
    const shuffled = [...allPokemonNames];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selectedPokemons = shuffled.slice(0, 30); // 30 cards
    renderGrid(selectedPokemons);
}

function renderGrid(pokemons) {
    grid.innerHTML = "";
    pokemons.forEach(name => {
        const card = document.createElement("div");
        card.classList.add("card");

        const img = document.createElement("img");
        img.src = `https://img.pokemondb.net/artwork/large/${name}.jpg`;
        img.alt = name;
        img.loading = "lazy";
        img.onerror = function () { this.src = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png"; };

        const label = document.createElement("div");
        label.classList.add("name");
        label.textContent = name.replace(/-/g, ' ');

        card.appendChild(img);
        card.appendChild(label);

        card.addEventListener("click", () => {
            if (gameState === "SELECTING") {
                selectPokemon(name);
            } else if (gameState === "PLAYING" || gameState === "FINISHED") {
                card.classList.toggle("defeated");
            }
        });

        grid.appendChild(card);
    });
}

function selectPokemon(name) {
    gameState = "PLAYING";

    // Update Sidebar
    selectedPokemonCard.className = "card";
    selectedPokemonCard.innerHTML = "";
    const img = document.createElement("img");
    img.src = `https://img.pokemondb.net/artwork/large/${name}.jpg`;
    img.alt = name;
    const label = document.createElement("div");
    label.classList.add("name");
    label.textContent = name.replace(/-/g, ' ').toUpperCase();
    selectedPokemonCard.appendChild(img);
    selectedPokemonCard.appendChild(label);

    if (conn) {
        conn.send({ type: 'READY' });
        appendChatMessage("System", "You selected your Pokémon. Waiting for opponent...");
        if (isOpponentReady) startMultiplayerGame();
    } else {
        // Single player
        document.getElementById("btnMakeGuess").style.display = "block";
    }
}

function startMultiplayerGame() {
    gameState = "PLAYING";
    appendChatMessage("System", "Both players ready! Start guessing!");

    if (isHost) {
        isMyTurn = true;
        canAsk = true;
        enableAskControls();
        appendChatMessage("System", "You go first!");
    } else {
        isMyTurn = false;
        canAsk = false;
        disableAskControls();
        appendChatMessage("System", "Opponent goes first.");
    }

    document.getElementById("btnMakeGuess").style.display = "block";
}

// Q&A Logic
const qaOptions = {
    "type": ["Normal", "Fire", "Water", "Grass", "Electric", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Steel", "Dark", "Fairy"],
    "color": ["Red", "Blue", "Yellow", "Green", "Black", "Brown", "Purple", "Gray", "White", "Pink"],
    "stage": ["Basic", "Stage 1", "Stage 2"]
};

function updateQuestionValues() {
    const type = questionTypeSelect.value;
    const values = qaOptions[type];
    questionValueSelect.innerHTML = "";
    values.forEach(val => {
        const option = document.createElement("option");
        option.value = val;
        option.textContent = val;
        questionValueSelect.appendChild(option);
    });
}
questionTypeSelect.addEventListener("change", updateQuestionValues);
updateQuestionValues();

btnAskQuestion.addEventListener("click", () => {
    if (!conn) { alert("Not connected!"); return; }
    if (!canAsk) { alert("Wait for your turn!"); return; }

    const type = questionTypeSelect.value;
    const val = questionValueSelect.value;
    const category = type === "type" ? "Type" : (type === "color" ? "Color" : "Evolution");
    const questionText = `Is it ${val} ${category}?`;

    conn.send({ type: 'QUESTION', text: questionText });
    appendChatMessage("You", "Asked: " + questionText);

    canAsk = false;
    disableAskControls();
});

function disableAskControls() {
    btnAskQuestion.disabled = true;
    btnAskQuestion.classList.add("disabled");
    btnAskQuestion.textContent = "Esperando al Oponente...";
}
function enableAskControls() {
    btnAskQuestion.disabled = false;
    btnAskQuestion.classList.remove("disabled");
    btnAskQuestion.textContent = "Preguntar";
}

let currentIncomingQuestion = "";
function showAnswerModal(question) {
    currentIncomingQuestion = question;
    modalQuestionText.textContent = "El oponente pregunta: " + question;
    answerModal.style.display = "flex";
}
btnAnswerYes.addEventListener("click", () => sendAnswer("SÍ"));
btnAnswerNo.addEventListener("click", () => sendAnswer("NO"));

function sendAnswer(response) {
    if (!conn) return;
    conn.send({ type: 'ANSWER', response: response, originalQuestion: currentIncomingQuestion });
    appendChatMessage("Tú", "Respondiste: " + response);
    answerModal.style.display = "none";
}

function endTurn() {
    canAsk = false;
    disableAskControls();
    conn.send({ type: 'TURN_PASS' });
    appendChatMessage("Sistema", "Fin del turno. Turno del oponente.");
}

// Guessing Logic
btnMakeGuess.addEventListener('click', () => {
    guessPokemonSelect.innerHTML = "";
    allPokemonNames.sort().forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        guessPokemonSelect.appendChild(option);
    });
    guessModal.style.display = "block";
});
btnCancelGuess.addEventListener('click', () => guessModal.style.display = "none");
btnConfirmGuess.addEventListener('click', () => {
    const guess = guessPokemonSelect.value;
    if (conn) {
        conn.send({ type: 'GUESS', pokemon: guess });
        appendChatMessage("Tú", "Adivinaste: " + guess);
        guessModal.style.display = "none";
    }
});

function handleOpponentGuess(guessedName) {
    const myPokemonName = selectedPokemonCard.querySelector('.name').textContent.toLowerCase();
    if (guessedName.toLowerCase() === myPokemonName) {
        conn.send({ type: 'CORRECT_GUESS' });
        alert("¡Perdiste! El oponente adivinó " + guessedName);
        gameState = "FINISHED";
    } else {
        conn.send({ type: 'LOSE', pokemon: guessedName });
        appendChatMessage("Sistema", "El oponente adivinó " + guessedName + " - ¡INCORRECTO!");
        isMyTurn = true;
        canAsk = true;
        enableAskControls();
        appendChatMessage("Sistema", "¡Tu Turno!");
    }
}

// Chat Logic
function appendChatMessage(sender, message) {
    const div = document.createElement("div");
    div.classList.add("chat-message");
    if (sender === "Tú") div.classList.add("self");
    else if (sender === "Oponente") div.classList.add("opponent");
    else div.classList.add("system");
    div.textContent = `${sender}: ${message}`;
    chatHistory.appendChild(div);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}
btnSendChat.addEventListener('click', sendChat);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
    const text = chatInput.value.trim();
    if (!text || !conn) return;
    conn.send({ type: 'CHAT', message: text });
    appendChatMessage("Tú", text);
    chatInput.value = "";
}

document.getElementById('btnExit').addEventListener('click', () => {
    window.location.href = 'index.html';
});

// Start
fetchPokemonData();
