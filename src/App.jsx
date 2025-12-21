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
import { Users, CheckSquare, Edit2, AlertCircle, Copy, Clock, Grid } from 'lucide-react';

// --- CONFIGURATION & UTILS ---

// Funny name generator words
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

// Grid Constants
const COLS = 6;
const ROWS = 4;
const TOTAL_CELLS = COLS * ROWS;

// --- FIREBASE INIT ---
const getFirebaseConfig = () => {
  if (import.meta.env && import.meta.env.VITE_FIREBASE_API_KEY) {
    return {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID
    };
  }
  return JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
};

const getAppId = () => {
  if (import.meta.env && import.meta.env.VITE_APP_ID) {
    return import.meta.env.VITE_APP_ID;
  }
  return typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
};

const firebaseConfig = getFirebaseConfig();
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = getAppId();

// --- COMPONENTS ---

const MiniGrid = ({ layout, checkedIndices, className = "" }) => {
  return (
    <div className={`grid grid-cols-6 gap-[1px] bg-gray-300 border border-gray-300 ${className}`}>
      {layout.map((cell, idx) => {
        const isChecked = checkedIndices.includes(idx);
        const isEmpty = cell === null;
        
        let bgColor = 'bg-white';
        if (isEmpty) bgColor = 'bg-gray-200'; // Gap
        if (isChecked) bgColor = 'bg-green-500'; // Marked

        return (
          <div key={idx} className={`${bgColor} w-full h-full`} />
        );
      })}
    </div>
  );
};

// 2. Main App Component
export default function SocialBingoApp() {
  // State
  const [user, setUser] = useState(null);
  const [view, setView] = useState('home'); // home, create, play
  const [gameId, setGameId] = useState('');
  
  // Home State (Recent Games)
  const [recentGames, setRecentGames] = useState([]);

  // Creation State
  const [inputList, setInputList] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Game State
  const [gameData, setGameData] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [myParticipantData, setMyParticipantData] = useState(null);
  const [newName, setNewName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // --- AUTH ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  // --- LOGIC: FETCH RECENT GAMES (HOME) ---
  useEffect(() => {
    if (view !== 'home') return;

    // Fetch last 6 games
    const q = query(
      collection(db, 'artifacts', appId, 'public', 'data', 'games'),
      orderBy('createdAt', 'desc'),
      limit(6)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const games = [];
      snapshot.forEach((doc) => {
        games.push({ id: doc.id, ...doc.data() });
      });
      setRecentGames(games);
    });

    return () => unsubscribe();
  }, [view]);


  // --- LOGIC: CREATE GAME ---
  const handleCreateGame = async () => {
    if (!inputList.trim()) return;
    
    // Validate Items
    const items = inputList.split('\n').filter(line => line.trim() !== '');
    if (items.length < 10 || items.length > 20) {
      alert("Please enter between 10 and 20 items.");
      return;
    }

    setIsCreating(true);

    // Shuffle globally
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    
    // Distribute Round-Robin
    const rows = [[], [], [], []];
    items.forEach((item, index) => {
        rows[index % 4].push(item);
    });

    const layout = [];
    
    // Fill gaps and shuffle rows
    rows.forEach(rowItems => {
        while (rowItems.length < COLS) {
            rowItems.push(null);
        }
        for (let i = rowItems.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rowItems[i], rowItems[j]] = [rowItems[j], rowItems[i]];
        }
        layout.push(...rowItems);
    });

    // Save to Firestore
    const newGameId = Math.random().toString(36).substring(2, 9);
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', newGameId), {
        layout,
        createdAt: serverTimestamp(),
        creatorId: user.uid,
        participantCount: 0 // Init count
      });
      setGameId(newGameId);
      setView('play');
    } catch (e) {
      console.error("Error creating game", e);
      setErrorMsg("Failed to create game. Try again.");
    } finally {
      setIsCreating(false);
    }
  };

  // --- LOGIC: JOIN & SYNC GAME ---

  // 1. Fetch Game Data
  useEffect(() => {
    if (view !== 'play' || !gameId || !user) return;

    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    
    const unsubGame = onSnapshot(gameRef, (docSnap) => {
      if (docSnap.exists()) {
        setGameData(docSnap.data());
        setErrorMsg('');
      } else {
        setErrorMsg('Game not found.');
        setGameData(null);
      }
    }, (err) => console.error("Game listener error:", err));

    return () => unsubGame();
  }, [view, gameId, user]);

  // 2. Fetch/Create My Participant Entry & Update Counter
  useEffect(() => {
    if (!gameId || !user || !gameData) return;

    const myPartRef = doc(db, 'artifacts', appId, 'public', 'data', `participants_${gameId}`, user.uid);
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);

    // Check if I exist, if not create me AND increment counter
    getDoc(myPartRef).then((snap) => {
      if (!snap.exists()) {
        const initialName = generateFunnyName();
        // Atomic batch would be better but separate writes are okay for this scale
        setDoc(myPartRef, {
          name: initialName,
          checkedIndices: [],
          userId: user.uid,
          lastActive: serverTimestamp()
        });
        // Increment global counter
        updateDoc(gameRef, {
           participantCount: increment(1)
        });
      }
    });

    // Listen to ALL participants
    const q = collection(db, 'artifacts', appId, 'public', 'data', `participants_${gameId}`);
    const unsubParts = onSnapshot(q, (snapshot) => {
      const parts = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        parts.push(data);
        if (data.userId === user.uid) {
          setMyParticipantData(data);
          if (!isEditingName && !newName) {
             setNewName(data.name);
          }
        }
      });

      // SORTING LOGIC: Last Active First
      parts.sort((a, b) => {
        const timeA = a.lastActive?.toMillis() || 0;
        const timeB = b.lastActive?.toMillis() || 0;
        return timeB - timeA; // Descending
      });

      setParticipants(parts);
    }, (err) => console.error("Participants listener error:", err));

    return () => unsubParts();
  }, [gameId, user, gameData]);


  // --- INTERACTIONS ---

  const toggleCell = async (index) => {
    if (!myParticipantData || gameData.layout[index] === null) return;

    const currentChecks = myParticipantData.checkedIndices || [];
    let newChecks;

    if (currentChecks.includes(index)) {
      newChecks = currentChecks.filter(i => i !== index);
    } else {
      newChecks = [...currentChecks, index];
    }

    const myPartRef = doc(db, 'artifacts', appId, 'public', 'data', `participants_${gameId}`, user.uid);
    // Update checks AND lastActive to trigger resort
    await setDoc(myPartRef, { 
      checkedIndices: newChecks, 
      lastActive: serverTimestamp() 
    }, { merge: true });
  };

  const updateName = async () => {
    if (!newName.trim()) return;
    const myPartRef = doc(db, 'artifacts', appId, 'public', 'data', `participants_${gameId}`, user.uid);
    await setDoc(myPartRef, { 
      name: newName,
      lastActive: serverTimestamp() // Name change pushes you to top
    }, { merge: true });
    setIsEditingName(false);
  };

  const copyLink = () => {
    const text = `Join my Bingo! Game ID: ${gameId}`;
    navigator.clipboard.writeText(text);
    alert("Game ID copied to clipboard!");
  };

  // --- RENDER HELPERS ---

  if (!user) return <div className="flex items-center justify-center h-screen bg-slate-50 text-slate-500">Connecting...</div>;

  // --- VIEW: HOME ---
  if (view === 'home') {
    return (
      <div className="min-h-screen bg-slate-100 p-6 flex flex-col items-center justify-center font-sans">
        <div className="w-full max-w-md space-y-6">
          
          {/* Main Action Card */}
          <div className="bg-white rounded-xl shadow-xl p-8 text-center">
            <h1 className="text-4xl font-extrabold text-slate-800 mb-2">BINGO!</h1>
            <p className="text-slate-500 mb-8">Social. Real-time. No login required.</p>
            
            <button 
              onClick={() => setView('create')}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg mb-4 transition flex items-center justify-center gap-2"
            >
              <Edit2 size={20} /> Create New Card
            </button>

            <div className="relative flex py-5 items-center">
              <div className="flex-grow border-t border-gray-300"></div>
              <span className="flex-shrink-0 mx-4 text-gray-400">OR</span>
              <div className="flex-grow border-t border-gray-300"></div>
            </div>

            <div className="flex gap-2">
              <input 
                type="text" 
                placeholder="Enter Game ID" 
                className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
              />
              <button 
                onClick={() => gameId && setView('play')}
                className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 px-4 rounded-lg transition"
              >
                Join
              </button>
            </div>
          </div>

          {/* Recent Games List */}
          <div className="space-y-2">
            <h3 className="text-slate-500 font-bold text-sm ml-2 uppercase tracking-wide">Recent Boards</h3>
            {recentGames.length === 0 ? (
               <div className="text-center text-slate-400 text-sm py-4">No active games found. Create one!</div>
            ) : (
              recentGames.map(g => {
                // Get readable preview text from valid items
                const previewText = g.layout
                  ? g.layout.filter(x => x).slice(0, 3).join(', ') + (g.layout.filter(x => x).length > 3 ? '...' : '')
                  : 'Empty Board';
                
                return (
                  <div 
                    key={g.id} 
                    onClick={() => { setGameId(g.id); setView('play'); }}
                    className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 cursor-pointer hover:border-indigo-400 hover:shadow-md transition group"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="font-bold text-slate-700 group-hover:text-indigo-600 transition">
                         {g.id}
                      </div>
                      <div className="flex items-center text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                         <Users size={12} className="mr-1"/> {g.participantCount || 0}
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2">
                      {previewText}
                    </p>
                  </div>
                );
              })
            )}
          </div>

        </div>
      </div>
    );
  }

  // --- VIEW: CREATE ---
  if (view === 'create') {
    const itemCount = inputList.split('\n').filter(l => l.trim()).length;
    
    return (
      <div className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans">
        <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-indigo-600 p-6">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Edit2 /> Create Bingo List
            </h2>
            <p className="text-indigo-200 text-sm mt-1">
              Enter between 10 and 20 items (one per line).
            </p>
          </div>
          
          <div className="p-6">
            <textarea
              className="w-full h-64 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-slate-50 text-slate-800"
              placeholder="E.g. Someone says 'Can you hear me?'&#10;Cat appears on camera&#10;Loud echo&#10;Forgot to mute..."
              value={inputList}
              onChange={(e) => setInputList(e.target.value)}
            />
            <div className="flex justify-between items-center mt-4">
              <div className={`text-sm font-bold ${itemCount >= 10 && itemCount <= 20 ? 'text-green-600' : 'text-slate-400'}`}>
                {itemCount}/20 items
              </div>
              <div className="flex gap-4">
                <button onClick={() => setView('home')} className="text-slate-500 hover:text-slate-800">Cancel</button>
                <button 
                  onClick={handleCreateGame}
                  disabled={isCreating || itemCount < 10 || itemCount > 20}
                  className="bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:bg-slate-300 transition"
                >
                  {isCreating ? 'Generating...' : 'Generate Card'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW: GAME ---
  if (!gameData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
         {errorMsg ? <div className="text-red-500 flex gap-2"><AlertCircle/> {errorMsg}</div> : "Loading Game..."}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 font-sans pb-20">
      
      {/* HEADER */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex flex-col">
            <h1 className="font-bold text-slate-800 text-lg md:text-xl">BINGO</h1>
            <div className="text-xs text-slate-500 flex items-center gap-1 cursor-pointer hover:text-indigo-600" onClick={copyLink}>
              ID: {gameId} <Copy size={10} />
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <div className="flex gap-1">
                <input 
                  autoFocus
                  className="border rounded px-2 py-1 text-sm w-32"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={updateName}
                  onKeyDown={(e) => e.key === 'Enter' && updateName()}
                />
              </div>
            ) : (
              <button 
                onClick={() => setIsEditingName(true)}
                className="flex flex-col items-end group"
              >
                 <span className="text-xs text-slate-400">You are</span>
                 <span className="font-bold text-indigo-600 flex items-center gap-1 group-hover:underline">
                   {myParticipantData?.name || '...'} <Edit2 size={12}/>
                 </span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-2 md:p-6">
        
        {/* THE BINGO CARD */}
        <div className="bg-white rounded-xl shadow-lg p-1 md:p-4 mb-8 overflow-hidden">
          <div 
             className="grid grid-cols-6 gap-[1px] bg-slate-200 border-2 border-slate-200"
             style={{ minWidth: 'min-content' }} 
          >
            {gameData.layout.map((item, idx) => {
              const isChecked = myParticipantData?.checkedIndices?.includes(idx);
              const isEmpty = item === null;
              
              if (isEmpty) {
                return (
                  <div key={idx} className="bg-slate-100 aspect-[4/3] relative flex items-center justify-center opacity-50 cursor-default">
                    <div className="w-2 h-2 rounded-full bg-slate-300"></div>
                  </div>
                );
              }

              return (
                <div 
                  key={idx}
                  onClick={() => toggleCell(idx)}
                  className={`
                    relative aspect-[4/3] p-1 md:p-2 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200
                    ${isChecked ? 'bg-emerald-50 text-emerald-900' : 'bg-white hover:bg-slate-50 text-slate-700'}
                  `}
                >
                  <span className="text-[10px] md:text-sm font-medium leading-tight select-none break-words w-full">
                    {item}
                  </span>
                  
                  {/* Checkmark overlay */}
                  {isChecked && (
                    <div className="absolute top-1 right-1 md:top-2 md:right-2 text-emerald-500">
                      <CheckSquare size={16} className="md:w-5 md:h-5" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* PARTICIPANTS LIST (Sorted by interaction) */}
        <div className="max-w-3xl mx-auto">
          <h3 className="text-slate-500 font-bold mb-4 flex items-center gap-2">
            <Users size={18} /> Participants ({participants.length})
          </h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {participants.map((p) => (
              <div key={p.userId} className="bg-white p-3 rounded-lg shadow-sm flex items-stretch gap-3 border border-slate-100 transition-all duration-500 ease-in-out">
                <div className="w-24 flex-shrink-0">
                   <MiniGrid 
                     layout={gameData.layout} 
                     checkedIndices={p.checkedIndices || []} 
                     className="h-full w-full"
                   />
                </div>
                
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex justify-between items-start">
                    <div className="font-bold text-slate-700 truncate text-sm">
                      {p.name} {p.userId === user.uid && '(You)'}
                    </div>
                  </div>
                  
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                    {(p.checkedIndices || []).length} marked
                  </div>
                  
                  {/* Progress bar */}
                  <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div 
                      className="bg-indigo-500 h-full rounded-full transition-all duration-300" 
                      style={{ 
                        width: `${Math.min(100, ((p.checkedIndices || []).length / (TOTAL_CELLS - gameData.layout.filter(x=>x===null).length)) * 100)}%` 
                      }} 
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}
