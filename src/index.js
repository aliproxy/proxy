import { createBareServer } from "@tomphttp/bare-server-node";
import express from "express";
import { createServer } from "node:http";
import { publicPath } from "ultraviolet-static";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { join } from "node:path";
import { hostname } from "node:os";
import fs from 'fs';
import base64 from 'base64-js';
import crypto from 'crypto';
import rateLimit from "express-rate-limit";

const bare = createBareServer("/bare/");
const app = express();

// Load our publicPath first and prioritize it over UV.
app.use(express.static(publicPath));
// Load vendor files last.
// The vendor's uv.config.js won't conflict with our uv.config.js inside the publicPath directory.
app.use("/uv/", express.static(uvPath));

// Function to generate a random key
function generateKey() {
    const keySizeBytes = 32;
    const randomBytes = crypto.randomBytes(keySizeBytes);
    const randomKey = base64.fromByteArray([...randomBytes]);
    return randomKey;
}

// Function to write keys to a file
function writeKeysToFile(filename, numKeys) {
    const keys = Array.from({ length: numKeys }, generateKey);
    fs.writeFileSync(filename, keys.join('\n'));
}

// Function to read keys from a file
function readKeysFromFile(filename) {
    const fileContent = fs.readFileSync(filename, 'utf-8');
    return fileContent.split('\n').filter(Boolean);
}

// Function to remove a key from a file
function removeKeyFromFile(filename, key) {
    const keys = readKeysFromFile(filename);
    const filteredKeys = keys.filter(k => k !== key);
    fs.writeFileSync(filename, filteredKeys.join('\n'));
}

// Specify the filename and the number of keys to generate
const filename = 'keys.txt';
const numKeysToGenerate = 50000;

// Generate and write keys to the file
writeKeysToFile(filename, numKeysToGenerate);

// New route to activate a key
let ipCount = {}; // In-memory object to store IP counts

app.get('/activate-key', (req, res) => {
  const ip = req.ip; // Get the IP address of the client

  // Check if the count for this IP is above 10
  if (ipCount[ip] && ipCount[ip] >= 2) {
    res.status(429).json({ success: false, message: 'Your IP has reached the limit of 2 keys per day. If someone else has the key at your school, please ask them to share! :)' });
    return;
  }

  const activatedKey = readKeysFromFile(filename)[0];
  
  if (activatedKey) {
    // Increment the count for this IP
    ipCount[ip] = (ipCount[ip] || 0) + 1;

    removeKeyFromFile(filename, activatedKey);
    res.json({ success: true, key: activatedKey, count: ipCount[ip] });
  } else {
    res.status(404).json({ success: false, message: 'No keys available for activation.' });
  }
});

// Error for everything else
app.use((req, res) => {
  res.status(404);
  res.sendFile(join(publicPath, "404.html"));
});

const server = createServer();

server.on("request", (req, res) => {
  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

server.on("listening", () => {
  const address = server.address();

  // by default we are listening on 0.0.0.0 (every interface)
  // we just need to list a few
  console.log("Listening on:");
  console.log(`\thttp://localhost:${address.port}`);
  console.log(`\thttp://${hostname()}:${address.port}`);
  console.log(
    `\thttp://${
      address.family === "IPv6" ? `[${address.address}]` : address.address
    }:${address.port}`
  );
});

// https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close();
  bare.close();
  process.exit(0);
}


// Configure rate limiting
const keyActivationRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  max: 1, // Allow only 1 request per windowMs
  message: { success: false, message: 'Too many requests, please try again later.' },
  keyGenerator: (req) => req.ip, // Use the client's IP address as the key for rate limiting
});

app.use('/activate-key', keyActivationRateLimit);

// Modify the /activate-key route
app.get('/activate-key', (req, res) => {
  const userIP = req.ip;
  const lastActivationTime = getLastActivationTime(userIP);

  // Check if the user has activated a key within the last 24 hours
  if (Date.now() - lastActivationTime < 24 * 60 * 60 * 1000) {
    res.status(429).json({ success: false, message: 'You can only activate one key per 24 hours.' });
  } else {
    const activatedKey = readKeysFromFile(filename)[0];
    if (activatedKey) {
      removeKeyFromFile(filename, activatedKey);
      setLastActivationTime(userIP, Date.now()); // Update the last activation time for the user
      res.json({ success: true, key: activatedKey });
    } else {
      res.status(404).json({ success: false, message: 'No keys available for activation.' });
    }
  }
});

// Function to get the last activation time for a given user IP
function getLastActivationTime(userIP) {
  // Implement your logic to retrieve the last activation time from a data store (e.g., a database)
  // Return 0 if no previous activation time is found.
  // Example: return someDataStore.get(`lastActivationTime:${userIP}`) || 0;
}

// Function to set the last activation time for a given user IP
function setLastActivationTime(userIP, timestamp) {
  // Implement your logic to store the last activation time in a data store (e.g., a database)
  // Example: someDataStore.set(`lastActivationTime:${userIP}`, timestamp);
}

server.listen({
  port,
});