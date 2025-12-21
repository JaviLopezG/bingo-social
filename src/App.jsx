import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc,
  increment,
  onSnapshot, 
  query, 
  orderBy,
  limit,
  serverTimestamp 
} from 'firebase/firestore';
import { Users, CheckSquare, Edit2, AlertCircle, Copy, Bug } from 'lucide-react';

// --- CONFIGURATION & UTILS ---

// Recuperamos la lectura desde .env (limpia y segura)
const getFirebaseConfig = () => {
  try {
    // Intento leer variables de Vite (Entorno local/producción)
    if (import.meta.env && import.meta.env.VITE_FIREBASE_API_KEY) {
      return {
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY.trim(),
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim(),
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim(),
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim(),
        appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim()
      };
    }
  } catch (e) {
    // Silencioso en entornos donde import.meta no existe
  }
  
  // Fallback para Sandbox interno (si existiera)
  return JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
};

const getAppId = () => {
  try {
    if (import.meta.env && import.meta.env.VITE_APP_ID) {
      return import.meta.env.VITE_APP_ID.trim();
    }
  } catch (e) {}
  return typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
};

// Inicialización
const firebaseConfig = getFirebaseConfig();
// Validación básica para evitar crash si el .env no carga
const isConfigValid = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.authDomain;

const app = isConfigValid ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
const appId = getAppId();


// --- GENERADORES ---
const ADJECTIVES = ['Funky', 'Grumpy', 'Cheeky', 'Sleepy', 'Hyper', 'Happy', 'Salty', 'Spicy', 'Lucky', 'Dizzy'];
const COLORS = ['Red', 'Blue', 'Pink', 'Neon', 'Lime', 'Cosmic', 'Rusty', 'Golden', 'Silver', 'Violet'];
const NOUNS = ['Badger', 'Cactus', 'Taco', 'Ninja', 'Panda', 'Toaster', 'Pickle', 'Muffin', 'Wizard', 'Goose'];

const generateFunnyName = () => {
  const col = COLORS[Math.floor(Math.random() * COLORS.length)];
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 99) + 1;
  return `${col}-${adj}-${noun}-${num}`;
};

const COLS = 6;
const ROWS = 4;
const TOTAL_CELLS = COLS * ROWS;

// --- COMPONENTES ---

const MiniGrid = ({ layout, checkedIndices, className = "" }) => {
  return (
    <div className={`grid grid-cols-6 gap-[1px] bg-gray-300 border border-gray-300 ${className}`}>
      {layout.map((cell, idx) => {
        const isChecked = checkedIndices.includes(idx);
        const isEmpty = cell === null;
        let bgColor = 'bg-white';
        if (isEmpty) bgColor = 'bg-gray-200';
        if (isChecked) bgColor = 'bg-green-500';
        return <div key={idx} className={`${bgColor} w-full h-full`} />;
      })}
    </div>
  );
};

export default function SocialBingoApp() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home');
  const [gameId, setGameId] = useState('');
  const [recentGames, setRecentGames] = useState([]);
  const [inputList, setInputList] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [gameData, setGameData] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [myParticipantData, setMyParticipantData] = useState(null);
  const [newName, setNewName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [authError, setAuthError] = useState('');

  // --- AUTH ---
  useEffect(() => {
    if (!app || !auth) return;

    const doAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
        let msg = err.message;
        if (err.code === 'auth/operation-not-allowed') msg = "Activa el modo Anónimo en Firebase Console.";
        if (err.code === 'auth/configuration-not-found') msg = "Error en authDomain. Revisa tu .env";
        setAuthError(msg);
      }
    };
    doAuth();
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // --- DATA FETCHING (Home) ---
  useEffect(() => {
    if (view !== 'home' || !user || !db) return;
    try {
      // Ordenamos por fecha de creación descendente
      const q = query(
        collection(db, 'artifacts', appId, 'public', 'data', 'games'),
        orderBy('createdAt', 'desc'),
        limit(6)
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const games = [];
        snapshot.forEach((doc) => games.push({ id: doc.id, ...doc.data() }));
        setRecentGames(games);
      }, (err) => {
        console.error("Firestore Error:", err);
        if (err.code === 'permission-denied') {
            setErrorMsg("Error: Habilita Firestore Database en tu consola de Firebase.");
        }
      });
      return () => unsubscribe();
    } catch (e) { console.error(e); }
  }, [view, user]);

  // --- ACTIONS ---
  
  const handleCreateGame = async () => {
    if (!inputList.trim()) return;
    const items = inputList.split('\n').filter(line => line.trim() !== '');
    if (items.length < 10 || items.length > 20) {
      alert("Please enter between 10 and 20 items.");
      return;
    }
    setIsCreating(true);
    
    // Shuffle global
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    // Reparto Round-Robin
    const rows = [[], [], [], []];
    items.forEach((item, index) => rows[index % 4].push(item));
    const layout = [];
    rows.forEach(rowItems => {
        while (rowItems.length < COLS) rowItems.push(null);
        for (let i = rowItems.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rowItems[i], rowItems[j]] = [rowItems[j], rowItems[i]];
        }
        layout.push(...rowItems);
    });

    const newGameId = Math.random().toString(36).substring(2, 9);
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', newGameId), {
        layout,
        createdAt: serverTimestamp(),
        creatorId: user.uid,
        participantCount: 0
      });
      setGameId(newGameId);
      setView('play');
    } catch (e) {
      console.error("Create Error:", e);
      alert("Error al crear. ¿Has habilitado Firestore Database en la consola?");
    } finally {
      setIsCreating(false);
    }
  };

  // Join Game & Listen
  useEffect(() => {
    if (view !== 'play' || !gameId || !user || !db) return;
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    
    return onSnapshot(gameRef, (docSnap) => {
      if (docSnap.exists()) {
        setGameData(docSnap.data());
        setErrorMsg('');
      } else {
        setErrorMsg('Game not found.');
        setGameData(null);
      }
    }, (err) => console.error("Game Listen Error:", err));
  }, [view, gameId, user]);

  // Participant Logic
  useEffect(() => {
    if (!gameId || !user || !gameData) return;
    const myPartRef = doc(db, 'artifacts', appId, 'public', 'data', `participants_${gameId}`, user.uid);
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);

    getDoc(myPartRef).then((snap) => {
      if (!snap.exists()) {
        const initialName = generateFunnyName();
        setDoc(myPartRef, {
          name: initialName,
          checkedIndices: [],
          userId: user.uid,
          lastActive: serverTimestamp()
        });
        updateDoc(gameRef, { participantCount: increment(1) });
      }
    });

    const q = collection(db, 'artifacts', appId, 'public', 'data', `participants_${gameId}`);
    return onSnapshot(q, (snapshot) => {
      const parts = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        parts.push(data);
        if (data.userId === user.uid) {
          setMyParticipantData(data);
          if (!isEditingName && !newName) setNewName(data.name);
        }
      });
      // Ordenar por última interacción
      parts.sort((a, b) => (b.lastActive?.toMillis() || 0) - (a.lastActive?.toMillis() || 0));
      setParticipants(parts);
    });
  }, [gameId, user, gameData]);

  const toggleCell = async (index) => {
    if (!myParticipantData || gameData.layout[index] === null) return;
    const currentChecks = myParticipantData.checkedIndices || [];
    let newChecks = currentChecks.includes(index) 
      ? currentChecks.filter(i => i !== index) 
      : [...currentChecks, index];
    const myPartRef = doc(db, 'artifacts', appId, 'public', 'data', `participants_${gameId}`, user.uid);
    await setDoc(myPartRef, { checkedIndices: newChecks, lastActive: serverTimestamp() }, { merge: true });
  };

  const updateName = async () => {
    if (!newName.trim()) return;
    const myPartRef = doc(db, 'artifacts', appId, 'public', 'data', `participants_${gameId}`, user.uid);
    await setDoc(myPartRef, { name: newName, lastActive: serverTimestamp() }, { merge: true });
    setIsEditingName(false);
  };

  const copyLink = () => {
    // Intenta copiar la URL completa si está desplegado
    const url = window.location.href.split('?')[0] + `?game=${gameId}`;
    navigator.clipboard.writeText(url);
    alert("Enlace copiado al portapapeles: " + url);
  };

  // --- RENDER ---
  
  if (!user) {
    return (
      <div className="w-full min-h-screen bg-slate-50 flex flex-col items-center justify-center p-8 text-center text-slate-500 font-sans">
        {/* RESET CSS GLOBAL: Esto arregla el problema del "width 100%" */}
        <style>{`
          #root { width: 100%; max-width: 100%; margin: 0; padding: 0; text-align: left; }
          body { display: block; place-items: unset; min-width: 0; }
        `}</style>
        
        {!isConfigValid ? (
          <div className="bg-red-50 border border-red-200 p-6 rounded-lg max-w-lg">
            <h3 className="text-red-700 font-bold flex items-center gap-2 justify-center"><AlertCircle/> Configuración Inválida</h3>
            <p className="text-sm mt-2">Revisa tu archivo <code>.env</code></p>
          </div>
        ) : authError ? (
          <div className="bg-red-50 border border-red-200 p-6 rounded-lg max-w-lg text-red-700">
             <h3 className="font-bold flex gap-2 justify-center items-center"><Bug/> Error de Autenticación</h3>
             <p className="mt-2 text-sm font-mono">{authError}</p>
          </div>
        ) : (
          <div className="animate-pulse flex flex-col items-center gap-4">
             <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
             <span>Conectando...</span>
          </div>
        )}
      </div>
    );
  }

  // --- VISTAS ---

  // HOME
  if (view === 'home') {
    return (
      <div className="w-full min-h-screen bg-slate-100 p-4 md:p-6 flex flex-col items-center justify-center font-sans">
        {/* RESET CSS GLOBAL: Esto arregla el problema del "width 100%" */}
        <style>{`
          #root { width: 100%; max-width: 100%; margin: 0; padding: 0; text-align: left; }
          body { display: block; place-items: unset; min-width: 0; }
        `}</style>

        <div className="w-full max-w-md md:max-w-2xl space-y-6 transition-all duration-300">
          <div className="bg-white rounded-xl shadow-xl p-8 text-center">
            <h1 className="text-4xl font-extrabold text-slate-800 mb-2">BINGO!</h1>
            <p className="text-slate-500 mb-8">Social. Real-time.</p>
            
            <button onClick={() => setView('create')} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg mb-4 transition flex items-center justify-center gap-2">
              <Edit2 size={20} /> Crear Nuevo
            </button>

            <div className="relative flex py-5 items-center">
              <div className="flex-grow border-t border-gray-300"></div><span className="flex-shrink-0 mx-4 text-gray-400">O</span><div className="flex-grow border-t border-gray-300"></div>
            </div>

            <div className="flex gap-2">
              <input type="text" placeholder="ID de Partida" className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={gameId} onChange={(e) => setGameId(e.target.value)} />
              <button onClick={() => gameId && setView('play')} className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 px-4 rounded-lg transition">Unirse</button>
            </div>
            
            {/* Aviso si Firestore falla */}
            {errorMsg && <div className="mt-4 text-xs text-red-500 bg-red-50 p-2 rounded">{errorMsg}</div>}
          </div>

          <div className="space-y-2">
            <h3 className="text-slate-500 font-bold text-sm ml-2 uppercase tracking-wide">Tableros Recientes</h3>
            {recentGames.length === 0 && <div className="text-center text-slate-400 text-sm italic">No hay partidas recientes.</div>}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {recentGames.map(g => (
                <div key={g.id} onClick={() => { setGameId(g.id); setView('play'); }} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 cursor-pointer hover:border-indigo-400 hover:shadow-md transition group">
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-bold text-slate-700 group-hover:text-indigo-600 transition">{g.id}</div>
                    <div className="flex items-center text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-full"><Users size={12} className="mr-1"/> {g.participantCount || 0}</div>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-2">{g.layout ? g.layout.filter(x => x).slice(0, 3).join(', ') + '...' : 'Vacío'}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // CREATE
  if (view === 'create') {
    const itemCount = inputList.split('\n').filter(l => l.trim()).length;
    return (
      <div className="w-full min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
        {/* RESET CSS GLOBAL */}
        <style>{`#root { width: 100%; max-width: 100%; } body { display: block; place-items: unset; }`}</style>
        
        {/* ANCHO RESPONSIVE AUMENTADO AQUÍ (max-w-2xl -> max-w-4xl en md) */}
        <div className="w-full max-w-2xl md:max-w-4xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300">
          <div className="bg-indigo-600 p-6"><h2 className="text-2xl font-bold text-white flex items-center gap-2"><Edit2 /> Crear Lista</h2><p className="text-indigo-200 text-sm mt-1">Introduce de 10 a 20 frases.</p></div>
          <div className="p-6">
            <textarea className="w-full h-64 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-slate-50 text-slate-800" placeholder="Frases..." value={inputList} onChange={(e) => setInputList(e.target.value)} />
            <div className="flex justify-between items-center mt-4">
              <div className={`text-sm font-bold ${itemCount >= 10 && itemCount <= 20 ? 'text-green-600' : 'text-slate-400'}`}>{itemCount}/20 items</div>
              <div className="flex gap-4"><button onClick={() => setView('home')} className="text-slate-500 hover:text-slate-800">Cancelar</button><button onClick={handleCreateGame} disabled={isCreating || itemCount < 10 || itemCount > 20} className="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">Generar</button></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // PLAY
  if (!gameData) return <div className="w-full min-h-screen flex items-center justify-center font-sans">{errorMsg ? <div className="text-red-500 flex gap-2"><AlertCircle/> {errorMsg}</div> : "Cargando..."}</div>;

  return (
    <div className="w-full min-h-screen bg-slate-100 font-sans pb-20">
      {/* RESET CSS GLOBAL */}
      <style>{`#root { width: 100%; max-width: 100%; } body { display: block; place-items: unset; }`}</style>

      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex flex-col"><h1 className="font-bold text-slate-800 text-lg md:text-xl">BINGO</h1><div className="text-xs text-slate-500 flex items-center gap-1 cursor-pointer hover:text-indigo-600" onClick={copyLink}>ID: {gameId} <Copy size={10} /></div></div>
          <div className="flex items-center gap-2">
            {isEditingName ? <input autoFocus className="border rounded px-2 py-1 text-sm w-32" value={newName} onChange={(e) => setNewName(e.target.value)} onBlur={updateName} onKeyDown={(e) => e.key === 'Enter' && updateName()} /> : <button onClick={() => setIsEditingName(true)} className="flex flex-col items-end group"><span className="text-xs text-slate-400">Eres</span><span className="font-bold text-indigo-600 flex items-center gap-1 group-hover:underline">{myParticipantData?.name || '...'} <Edit2 size={12}/></span></button>}
          </div>
        </div>
      </header>
      {/* ANCHO RESPONSIVE AUMENTADO AQUÍ (max-w-5xl -> max-w-7xl) */}
      <main className="w-full max-w-7xl mx-auto p-2 md:p-6 transition-all duration-300">
        <div className="bg-white rounded-xl shadow-lg p-1 md:p-4 mb-8 overflow-hidden">
          <div className="grid grid-cols-6 gap-[1px] bg-slate-200 border-2 border-slate-200" style={{ minWidth: 'min-content' }}>
            {gameData.layout.map((item, idx) => {
              if (item === null) return <div key={idx} className="bg-slate-100 aspect-[4/3] relative flex items-center justify-center opacity-50 cursor-default"><div className="w-2 h-2 rounded-full bg-slate-300"></div></div>;
              const isChecked = myParticipantData?.checkedIndices?.includes(idx);
              return <div key={idx} onClick={() => toggleCell(idx)} className={`relative aspect-[4/3] p-1 md:p-2 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 ${isChecked ? 'bg-emerald-50 text-emerald-900' : 'bg-white hover:bg-slate-50 text-slate-700'}`}><span className="text-[10px] md:text-sm lg:text-base font-medium leading-tight select-none break-words w-full">{item}</span>{isChecked && <div className="absolute top-1 right-1 md:top-2 md:right-2 text-emerald-500"><CheckSquare size={16} className="md:w-6 md:h-6" /></div>}</div>;
            })}
          </div>
        </div>
        <div className="max-w-5xl mx-auto">
          <h3 className="text-slate-500 font-bold mb-4 flex items-center gap-2"><Users size={18} /> Participantes ({participants.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {participants.map((p) => (
              <div key={p.userId} className="bg-white p-3 rounded-lg shadow-sm flex items-stretch gap-3 border border-slate-100 transition-all duration-500 ease-in-out">
                <div className="w-24 flex-shrink-0"><MiniGrid layout={gameData.layout} checkedIndices={p.checkedIndices || []} className="h-full w-full" /></div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="font-bold text-slate-700 truncate text-sm">{p.name} {p.userId === user.uid && '(Tú)'}</div>
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">{(p.checkedIndices || []).length} marcados</div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden"><div className="bg-indigo-500 h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, ((p.checkedIndices || []).length / (TOTAL_CELLS - gameData.layout.filter(x=>x===null).length)) * 100)}%` }} /></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
