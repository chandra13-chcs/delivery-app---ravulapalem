// ==========================================
// 🚀 SHARED FIREBASE FIRESTORE CONFIG
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBW6PuEVu91Ej8bA0FCAEdYTyhSMu912yM",
  authDomain: "myshopzy-ravulapalem-96b34.firebaseapp.com",
  projectId: "myshopzy-ravulapalem-96b34",
  storageBucket: "myshopzy-ravulapalem-96b34.firebasestorage.app",
  messagingSenderId: "1082906750454",
  appId: "1:1082906750454:web:14b7f951da98596ee02bd7"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();