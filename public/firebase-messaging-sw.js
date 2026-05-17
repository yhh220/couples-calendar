importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDi7XwLcg8nGmYbaEqXBLvSFoQ_W9ZTqgQ",
  authDomain: "multipurpose-calendar.firebaseapp.com",
  projectId: "multipurpose-calendar",
  storageBucket: "multipurpose-calendar.firebasestorage.app",
  messagingSenderId: "55586529047",
  appId: "1:55586529047:web:70492e3322a3334affa152"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification ?? {};
  self.registration.showNotification(title ?? 'Calendar', {
    body: body ?? '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: payload.data ?? {},
  });
});
