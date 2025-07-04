//// Firebase initialization and export for React app
// PUBLIC_INTERFACE
/**
 * This module initializes and exports the Firebase app and Firestore database.
 * Sensitive config values are loaded from environment variables.
 *
 * How to use:
 *   import { app, db } from './services/firebase';
 */

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// All config values are loaded via environment variables for security
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { app, db };
