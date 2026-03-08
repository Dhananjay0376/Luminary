window.LUMINARY_CONFIG = {
  firebase: {
    apiKey: 'your-firebase-api-key',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project-id',
    appId: 'your-firebase-app-id',
    storageBucket: 'your-project.firebasestorage.app',
    messagingSenderId: 'your-messaging-sender-id'
  },
  cloudflare: {
    accountId: 'your-cloudflare-account-id',
    bucketName: 'your-r2-bucket-name',
    publicBaseUrl: 'https://media.example.com',
    workerBaseUrl: 'https://your-worker.your-subdomain.workers.dev'
  }
};
