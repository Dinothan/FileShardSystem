let socket = io();

socket.on("status", (message) => {
  // console.log("messageq :", message);
  let content = document.createTextNode(message);
  let li = document.createElement("li");
  li.className = "list-group-item";
  li.appendChild(content);
  document.getElementById("log-list").appendChild(li);
});

socket.on("newLeader", (node) => {
  document.getElementById("leader").innerHTML = ` ${node.leaderId}`;
  document.getElementById("learner").innerHTML = ` ${node.learnerId}`;
});

socket.on("fileupload", (message) => {
  document.getElementById("msg").innerHTML = message;
  document.getElementById("inputfile").style.display = "none";
  document.getElementById("inputdownload").style.display = "block";
});

socket.on("disconnect", () => {
  socket.close();
  console.log("Socket connection closed!");
});

function killing() {
  socket.emit("kill", "");
}

function fileUpload(event) {
  var y = document.getElementById("mySelect");
  const files = y.files[0];

  var reader = new FileReader();
  reader.onload = function (event) {
    socket.emit("upload", event.target.result);
  };
  reader.readAsDataURL(files);
}

socket.on("download", (message) => {
  window.location.href = message;
});

function downloding() {
  socket.emit("download", "");
}
