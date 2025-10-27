// src/awsConfig.js
const awsConfig = {
  Auth: {
    Cognito: {
      userPoolId: "us-east-1_3c5R7lfM6",            // ← remplace par le tien
      userPoolClientId: "6e2c5qo5j2thd6mopicc91g90f", // ← remplace par le tien
      // (optionnel) identityPoolId: "us-east-1:xxxx-xxxx-....",

      // Hosted UI (OAuth)
      loginWith: {
        oauth: {
          domain: "https://us-east-13c5r7lfm6.auth.us-east-1.amazoncognito.com", // ← remplace
          scopes: ["openid", "email", "profile"],
          // en v6 on peut mettre une string ou un tableau de strings
          redirectSignIn: ["http://localhost:5173/"],
          redirectSignOut: ["http://localhost:5173/"],
          responseType: "code",
        },
      },
    },
  },
};

export default awsConfig;
