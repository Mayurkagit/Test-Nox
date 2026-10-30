import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCCa91TCGNpAUkPT1Q0ORWMFWWue0VBvow',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'dda-db-rs.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'dda-db-rs',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'dda-db-rs.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '459113193542',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:459113193542:web:0cc2b35f04fed4a6202a47',
};

// Initialize Firebase safely
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
