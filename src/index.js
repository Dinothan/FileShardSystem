"use strict";
const express = require("express");
const app = express();
const axios = require("axios");
const server = require("http").createServer(app);
const io = require("socket.io")(server);
const bodyParser = require("body-parser");
const path = require("path");
const md5 = require("md5");
const addresses = require("./buildHosts").addresses;

let baseIndexServer = process.env.BASE_INDEX || 0;
let id = getId(addresses[baseIndexServer].port);
let leaderId = getId(Math.max(...calculateLeader()));
const secondMax = calculateLeader().splice(calculateLeader().length - 2, 1);
let learnerId = getId(secondMax[0]);
let isCoordinator = true;
let isUP = true;
let check = "on";
let status = "ok";
let message = "";
let fileObj = [];
let leaderCheckSum = [];
let nodeStorage = [];

// Servers instance
const servers = new Map();
Object.keys(addresses).forEach((key) => {
  if (Number(key) !== baseIndexServer) {
    servers.set(
      getId(addresses[key].port),
      `http://${addresses[key].host}:${addresses[key].port}`
    );
  }
});

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.engine("pug", require("pug").__express);
app.set("views", path.join(__dirname, "../public/views"));
app.set("view engine", "pug");
app.use(express.static(path.join(__dirname, "../public")));

// Routes
app.get("/", function (req, res) {
  res.render("index", { id, idLeader: leaderId, idLearner: learnerId });
});

app.post("/ping", (req, res) => {
  //other nodes ping to leader
  handleRequest(req);
  sendMessage(
    `${new Date().toLocaleString()} - server ${req.body.id} it's pinging me`
  );
  res.status(200).send({ serverStatus: status });
});

app.post("/isCoordinator", (req, res) => {
  handleRequest(req);
  res.status(200).send({ isCoor: isCoordinator });
});

app.post("/election", (req, res) => {
  handleRequest(req);
  if (!isUP) {
    sendMessage(
      `${new Date().toLocaleString()} - server ${req.body.id} fallen leader`
    );
    res.status(200).send({ accept: "no" });
  } else {
    sendMessage(
      `${new Date().toLocaleString()} - server ${
        req.body.id
      } asked me if I am down, and I am not , I win, that is bullying`
    );
    res.status(200).send({ accept: "ok" });
  }
});

app.post("/putCoordinator", (req, res) => {
  handleRequest(req);
  startElection();
  sendMessage(
    `${new Date().toLocaleString()} - server ${
      req.body.id
    } put me as coordinator`
  );
  res.status(200).send("ok");
});

app.post("/newLeader", async (req, res) => {
  handleRequest(req);
  leaderId = req.body.idLeader;
  learnerId = req.body.idLearner;
  res.status(200).send("ok");
  io.emit("newLeader", { leaderId, learnerId });
  await checkLeader();
});

app.post("/fileupload", async (req, res) => {
  handleRequest(req);
  message = req.body.message;
  res.status(200).send("ok");
  io.emit("fileupload", message);
});

app.post("/download", async (req, res) => {
  handleRequest(req);
  let down = req.body.message;
  res.status(200).send("ok");
  io.emit("download", down);
});

const startElection = (_) => {
  let someoneAnswer = false;
  isCoordinator = true;
  sendMessage(`${new Date().toLocaleString()} - Coordinating the election`);

  servers.forEach(async (value, key) => {
    if (key > id) {
      try {
        let response = await axios.post(value + "/election", { id });
        if (response.data.accept === "ok" && !someoneAnswer) {
          someoneAnswer = true;
          isCoordinator = false;
          await axios.post(value + "/putCoordinator", { id });
        }
      } catch (error) {
        console.log(error);
      }
    }
  });

  setTimeout(() => {
    if (!someoneAnswer) {
      leaderId = id;
      learnerId = id - 10;
      sendMessage(`${new Date().toLocaleString()} - I am leader`);
      io.emit("newLeader", leaderId);
      servers.forEach(
        async (value) =>
          await axios.post(value + "/newLeader", {
            idLeader: leaderId,
            idLearner: learnerId,
          })
      );
    }
  }, 5000);
};

const sendMessage = (message) => {
  console.log(`Message: ${message}`);
  io.emit("status", message);
};

//leader kill by himself
io.on("connection", (socket) => {
  socket.on("kill", () => {
    sendMessage(`${new Date().toLocaleString()} - Not a leader anymore`);
    status = "fail";
    isUP = false;
    isCoordinator = false;
  });

  socket.on("upload", (file) => {
    sendMessage(`${new Date().toLocaleString()} - File Uploaded`);

    let len = file.length / addresses.length - 2;
    let arr = [];
    let char = 0;
    let checkSumlist = [];
    let tempsum = [];

    //Split into chunk files with node count
    for (let i = 0; i < addresses.length - 2; i++) {
      arr.push(file.substring(char, len));
      char = len;
      if (i === addresses.length - 4) {
        len = file.length;
      } else {
        len = file.length - len;
      }
    }
    fileObj = arr;

    arr.forEach((res) => tempsum.push(md5(res)));

    servers.forEach(async (value) => {
      if (
        value !== `http://0.0.0.0:80${leaderId}` &&
        value !== `http://0.0.0.0:80${learnerId}`
      ) {
        checkSumlist.push({
          host: value,
          checksum: arr,
        });
        await axios.post(value + "/fileupload", {
          message: "File Uploaded Successfully and Received Chunk files",
          chunkFiles: arr,
        });
      } else if (value === `http://0.0.0.0:80${learnerId}`) {
        await axios.post(value + "/fileupload", {
          message: "File Uploaded Successfully and Received checksum",
          checksumList: tempsum,
        });
      } else {
        await axios.post(value + "/fileupload", {
          message: "File Uploaded Successfully, You can Download the File Now",
        });
      }
    });
    leaderCheckSum = tempsum;
    nodeStorage = checkSumlist;
  });

  socket.on("download", () => {
    // check crashed chunk files
    let uncorruptedFiles = [];
    let flag = false;
    leaderCheckSum &&
      leaderCheckSum.length > 0 &&
      leaderCheckSum.forEach((res, index) => {
        nodeStorage &&
          nodeStorage.length > 0 &&
          nodeStorage.forEach((obj) => {
            if (flag && res === md5(obj.checksum[index])) {
              uncorruptedFiles.push(obj.checksum[index - 1]);
              flag === false;
            }
            if (res !== md5(obj.checksum[index])) {
              flag === true;
            } else {
              uncorruptedFiles.push(obj.checksum[index]);
            }
          });
      });

    let temp = "";
    if (uncorruptedFiles && uncorruptedFiles.length > 0) {
      uncorruptedFiles.forEach((res, ind) => {
        if (res[res.length - 1] === ",") {
          temp = temp + res.slice(0, -1);
        } else {
          temp = temp + res;
        }
      });
    }
    servers.forEach(async (value) => {
      if (
        value !== `http://0.0.0.0:80${leaderId}` &&
        value !== `http://0.0.0.0:80${learnerId}`
      ) {
        await axios.post(value + "/fileupload", {
          message: "Send file to learner node",
        });
      }
    });
    axios.post(`http://0.0.0.0:80${learnerId}` + "/fileupload", {
      message: "Comparing whether chunk file is corrupted",
    });

    axios.post(`http://0.0.0.0:80${leaderId}` + "/download", {
      message: temp,
    });
    sendMessage(`${new Date().toLocaleString()} - File Downloading`);
  });
});

const checkLeader = async (_) => {
  if (!isUP) {
    check = "off";
  }
  //ping leader (exclude leader)
  if (id !== leaderId && check !== "off") {
    try {
      //ping to leader - request
      let response = await axios.post(servers.get(leaderId) + "/ping", { id });

      if (response.data.serverStatus === "ok") {
        //nodes ping the leader - show in UI
        sendMessage(
          `${new Date().toLocaleString()} - Ping to leader server ${leaderId}: ${
            response.data.serverStatus
          }`
        );
        setTimeout(checkLeader, 12000);
      } else {
        //leader node fail
        sendMessage(
          `${new Date().toLocaleString()} - Server leader  ${leaderId} down: ${
            response.data.serverStatus
          } New leader needed`
        );
        checkCoordinator();
      }
    } catch (error) {
      //leader node fail
      sendMessage(
        `${new Date().toLocaleString()} - Server leader  ${leaderId} down: New leader needed`
      );
      checkCoordinator();
      console.log(error);
    }
  }
};

const checkCoordinator = (_) => {
  servers.forEach(async (value, key) => {
    try {
      let response = await axios.post(value + "/isCoordinator", { id });

      if (response.data.isCoor === "true") {
        sendMessage(
          `${new Date().toLocaleString()} - server ${key} is doing the election`
        );
        return true;
      } else {
        sendMessage(
          `${new Date().toLocaleString()} - server ${key} is not doing the election`
        );
      }
    } catch (error) {
      console.log(error);
    }
  });

  if (isUP) {
    startElection();
  }
};

function getId(server) {
  return server - 8000;
}

function calculateLeader() {
  let ports = [];
  addresses.forEach((server) => {
    ports.push(server.port);
  });
  return ports;
}

function handleRequest(req) {
  console.log(
    `${new Date().toLocaleString()} - Handle request in ${req.method}: ${
      req.url
    } by ${req.hostname}`
  );
}

server.listen(addresses[baseIndexServer].port, addresses[baseIndexServer].host);
console.log(
  `App listening on http://${addresses[baseIndexServer].host}:${addresses[baseIndexServer].port}`
);
setTimeout(checkLeader, 3000);
