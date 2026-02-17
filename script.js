const grid = document.getElementById("pokemonGrid");
const seedInput = document.getElementById("seedInput");
const btnLoad = document.getElementById("btnLoad");
const btnRandom = document.getElementById("btnRandom");
const currentSeedDisplay = document.getElementById("currentSeedDisplay");
const btnCopy = document.getElementById("btnCopy");
const selectedPokemonCard = document.getElementById("selectedPokemonCard");

let allPokemonNames = [];
let currentSeed = null;
let gameState = "SELECTING"; // 'SELECTING' | 'PLAYING'

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
        const response = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1000');
        const data = await response.json();
        allPokemonNames = data.results.map(p => p.name);

        // Initial load with random seed
        initGame(Math.floor(Math.random() * 1000000));
    } catch (error) {
        console.error("Error fetching Pokemon:", error);
        alert("Error cargando Pokémon. Intenta recargar la página.");
    }
}

function initGame(seed) {
    currentSeed = seed;
    currentSeedDisplay.textContent = `Seed: ${seed}`;
    seedInput.value = "";

    // Reset Game State
    gameState = "SELECTING";
    selectedPokemonCard.innerHTML = '<div class="placeholder-text">?</div>';
    selectedPokemonCard.className = "card placeholder-card";

    // Setup RNG
    const rng = mulberry32(seed);

    // Shuffle and pick 30
    // Fisher-Yates shuffle but using our seeded rng
    const shuffled = [...allPokemonNames];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selectedPokemons = shuffled.slice(0, 30);
    renderGrid(selectedPokemons);
}

function renderGrid(pokemons) {
    grid.innerHTML = "";
    pokemons.forEach(name => {
        const card = document.createElement("div");
        card.classList.add("card");

        const img = document.createElement("img");
        // Prefer pokemondb for consistency, fallback to official artwork if needed (names match usually)
        img.src = `https://img.pokemondb.net/artwork/large/${name}.jpg`;
        img.alt = name;
        img.loading = "lazy";

        // Add error handling for images
        img.onerror = function () {
            this.src = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png"; // Fallback placeholder
        };

        const label = document.createElement("div");
        label.classList.add("name");
        label.textContent = name.replace(/-/g, ' ');

        card.appendChild(img);
        card.appendChild(label);

        card.addEventListener("click", () => {
            if (gameState === "SELECTING") {
                selectPokemon(name);
            } else {
                card.classList.toggle("defeated");
            }
        });

        grid.appendChild(card);
    });
}

function selectPokemon(name) {
    gameState = "PLAYING";

    // Update Sidebar Card
    selectedPokemonCard.className = "card"; // Remove placeholder class
    selectedPokemonCard.innerHTML = ""; // Clear placeholder

    const img = document.createElement("img");
    img.src = `https://img.pokemondb.net/artwork/large/${name}.jpg`;
    img.alt = name;

    const label = document.createElement("div");
    label.classList.add("name");
    label.textContent = name.replace(/-/g, ' ').toUpperCase();

    selectedPokemonCard.appendChild(img);
    selectedPokemonCard.appendChild(label);
}

// Event Listeners
btnLoad.addEventListener('click', () => {
    const seed = parseInt(seedInput.value);
    if (!isNaN(seed)) {
        initGame(seed);
    } else {
        alert("Por favor ingresa un número válido como seed.");
    }
});

btnRandom.addEventListener('click', () => {
    initGame(Math.floor(Math.random() * 1000000));
});

btnCopy.addEventListener('click', () => {
    if (currentSeed !== null) {
        navigator.clipboard.writeText(currentSeed).then(() => {
            const originalText = btnCopy.textContent;
            btnCopy.textContent = "✅";
            setTimeout(() => btnCopy.textContent = originalText, 1500);
        });
    }
});

// Start
fetchPokemonData();
