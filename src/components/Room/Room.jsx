import React, { useState, useEffect, useRef } from "react";
import Peer from "simple-peer";
import styled from "styled-components";
import socket from "../../socket";
import VideoCard from "../Video/VideoCard";
import BottomBar from "../BottomBar/BottomBar";
import Chat from "../Chat/Chat";

export const Room = ({ roomId }) => {
  const currentUser = sessionStorage.getItem("user");
  const [peers, setPeers] = useState([]);
  const [userVideoAudio, setUserVideoAudio] = useState({
    localUser: { video: true, audio: true },
  });
  const [videoDevices, setVideoDevices] = useState([]);
  const [displayChat, setDisplayChat] = useState(false);
  const [screenShare, setScreenShare] = useState(false);
  const [screenShareStream, setScreenShareStream] = useState(null);
  const [showVideoDevices, setShowVideoDevices] = useState(false);
  const [screenShareUser, setScreenShareUser] = useState(null);

  const peersRef = useRef([]);
  const userVideoRef = useRef();
  const screenShareRef = useRef();
  const userStream = useRef();
  useEffect(() => {
    if (screenShareStream && screenShareRef.current) {
      screenShareRef.current.srcObject = screenShareStream;
    }
  }, [screenShareStream]);
  useEffect(() => {
    // Get Video Devices
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const filtered = devices.filter((device) => device.kind === "videoinput");
      setVideoDevices(filtered);
    });

    // Set Back Button Event
    window.addEventListener("popstate", goToBack);

    // Connect Camera & Mic
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        userVideoRef.current.srcObject = stream;
        userStream.current = stream;

        socket.emit("BE-join-room", { roomId, userName: currentUser });
        socket.on("FE-user-join", (users) => {
          const screenSharer = users.find(user => user.info.isScreenSharing);
          if (screenSharer) {
            setScreenShareUser(screenSharer.info.userName);
          }
          socket.on("FE-screen-share-started", ({ userName }) => {
            setScreenShareUser(userName);
          });
      
          socket.on("FE-screen-share-stopped", () => {
            setScreenShareUser(null);
          });
          // all users
          const peers = [];
          users.forEach(({ userId, info }) => {
            let { userName, video, audio } = info;

            if (userName !== currentUser) {
              const peer = createPeer(userId, socket.id, stream);

              peer.userName = userName;
              peer.peerID = userId;

              peersRef.current.push({
                peerID: userId,
                peer,
                userName,
              });
              peers.push(peer);

              setUserVideoAudio((preList) => {
                return {
                  ...preList,
                  [peer.userName]: { video, audio },
                };
              });
            }
          });

          setPeers(peers);
        });
        if (screenShare && screenShareStream) {
          const screenTrack = screenShareStream.getTracks()[0];
          peer.addTrack(screenTrack, screenShareStream);
        }
        socket.on("FE-receive-call", ({ signal, from, info }) => {
          let { userName, video, audio } = info;
          const peerIdx = findPeer(from);

          if (!peerIdx) {
            const peer = addPeer(signal, from, stream);

            peer.userName = userName;

            peersRef.current.push({
              peerID: from,
              peer,
              userName: userName,
            });
            setPeers((users) => {
              return [...users, peer];
            });
            setUserVideoAudio((preList) => {
              return {
                ...preList,
                [peer.userName]: { video, audio },
              };
            });
          }
        });

        socket.on("FE-call-accepted", ({ signal, answerId }) => {
          const peerIdx = findPeer(answerId);
          peerIdx.peer.signal(signal);
        });

        socket.on("FE-user-leave", ({ userId, userName }) => {
          const peerIdx = findPeer(userId);
          peerIdx.peer.destroy();
          setPeers((users) => {
            users = users.filter((user) => user.peerID !== peerIdx.peer.peerID);
            return [...users];
          });
          peersRef.current = peersRef.current.filter(
            ({ peerID }) => peerID !== userId
          );
        });
      });

    socket.on("FE-toggle-camera", ({ userId, switchTarget }) => {
      const peerIdx = findPeer(userId);

      setUserVideoAudio((preList) => {
        let video = preList[peerIdx?.userName].video;
        let audio = preList[peerIdx?.userName].audio;

        if (switchTarget === "video") video = !video;
        else audio = !audio;

        return {
          ...preList,
          [peerIdx.userName]: { video, audio },
        };
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId, currentUser]);

  function createPeer(userId, caller, stream) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'turn:your-turn-server.com', username: 'username', credential: 'password' }
        ]
      }
    });
    peer.on('connect', () => {
      console.log('Peer connection established');
    });
    
    peer.on('error', (err) => {
      console.error('Peer connection error:', err);
    });
    peer.on("signal", (signal) => {
      socket.emit("BE-call-user", {
        userToCall: userId,
        from: caller,
        signal,
      });
    });
    peer.on("disconnect", () => {
      peer.destroy();
    });

    return peer;
  }

  function addPeer(incomingSignal, callerId, stream) {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
    });

    peer.on("signal", (signal) => {
      socket.emit("BE-accept-call", { signal, to: callerId });
    });

    peer.on("disconnect", () => {
      peer.destroy();
    });

    peer.signal(incomingSignal);

    return peer;
  }

  function findPeer(id) {
    return peersRef.current.find((p) => p.peerID === id);
  }

  function createUserVideo(peer, index, arr) {
    return (
      <VideoBox key={index}>
        {writeUserName(peer.userName)}
        <VideoCard peer={peer} number={arr.length} />
        <UserLabel>{peer.userName}</UserLabel>
      </VideoBox>
    );
  }

  function writeUserName(userName, index) {
    if (userVideoAudio.hasOwnProperty(userName)) {
      if (!userVideoAudio[userName].video) {
        return <UserName key={userName}>{userName}</UserName>;
      }
    }
  }

  const clickChat = (e) => {
    e.stopPropagation();
    setDisplayChat(!displayChat);
  };

  const goToBack = (e) => {
    e.preventDefault();
    socket.emit("BE-leave-room", { roomId, leaver: currentUser });
    sessionStorage.removeItem("user");
    window.location.href = "/";
  };

  const toggleCameraAudio = (e) => {
    const target = e.target.getAttribute("data-switch");

    setUserVideoAudio((preList) => {
      let videoSwitch = preList["localUser"].video;
      let audioSwitch = preList["localUser"].audio;

      if (target === "video") {
        const userVideoTrack = userVideoRef.current.srcObject.getVideoTracks()[0];
        videoSwitch = !videoSwitch;
        userVideoTrack.enabled = videoSwitch;
      } else {
        const userAudioTrack = userVideoRef.current.srcObject.getAudioTracks()[0];
        audioSwitch = !audioSwitch;

        if (userAudioTrack) {
          userAudioTrack.enabled = audioSwitch;
        } else {
          userStream.current.getAudioTracks()[0].enabled = audioSwitch;
        }
      }

      return {
        ...preList,
        localUser: { video: videoSwitch, audio: audioSwitch },
      };
    });

    socket.emit("BE-toggle-camera-audio", { roomId, switchTarget: target });
  };
  const replaceTrackForPeer = (peer, screenTrack) => {
    const sender = peer.getSenders().find(s => s.track.kind === 'video');
    if (sender) {
      sender.replaceTrack(screenTrack)
        .then(() => console.log("Track replaced for peer:", peer.id))
        .catch(err => console.error("Error replacing track:", err));
    } else {
      console.error("No video sender found for peer:", peer.id);
    }
  };
  const clickScreenSharing = () => {
    if (!screenShare) {
      navigator.mediaDevices.getDisplayMedia({ cursor: true })
        .then((stream) => {
          const screenTrack = stream.getTracks()[0];
  
          // Replace track for all existing peers
          peersRef.current.forEach(({ peer }) => {
            replaceTrackForPeer(peer, screenTrack);
          });
  
          setScreenShareStream(stream);
          setScreenShare(true);
          setScreenShareUser(currentUser);
  
          // Notify other users about screen sharing
          socket.emit("BE-screen-share-started", { roomId, userName: currentUser });
  
          screenTrack.onended = () => {
            stopScreenShare();
          };
        })
        .catch((err) => {
          console.error("Error starting screen share:", err);
          alert("Failed to start screen sharing. Please check your permissions and try again.");
        });
    } else {
      stopScreenShare();
    }
  };
  const stopScreenShare = () => {
    if (!screenShareStream) return;
  
    screenShareStream.getTracks().forEach((track) => track.stop());
  
    // Revert to camera video for all peers
    peersRef.current.forEach(({ peer }) => {
      const cameraTrack = userStream.current.getVideoTracks()[0];
      replaceTrackForPeer(peer, cameraTrack);
    });
  
    setScreenShare(false);
    setScreenShareStream(null);
    setScreenShareUser(null);
  
    // Notify other users about stopping screen share
    socket.emit("BE-screen-share-stopped", { roomId, userName: currentUser });
  };

  const expandScreen = (e) => {
    const elem = e.target;

    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    } else if (elem.mozRequestFullScreen) {
      elem.mozRequestFullScreen();
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    } else if (elem.msRequestFullscreen) {
      elem.msRequestFullscreen();
    }
  };

  const clickCameraDevice = (event) => {
    if (event && event.target && event.target.dataset && event.target.dataset.value) {
      const deviceId = event.target.dataset.value;
      const enabledAudio = userVideoRef.current.srcObject.getAudioTracks()[0].enabled;

      navigator.mediaDevices
        .getUserMedia({ video: { deviceId }, audio: enabledAudio })
        .then((stream) => {
          const newStreamTrack = stream.getTracks().find((track) => track.kind === "video");
          const oldStreamTrack = userStream.current.getTracks().find((track) => track.kind === "video");

          userStream.current.removeTrack(oldStreamTrack);
          userStream.current.addTrack(newStreamTrack);

          peersRef.current.forEach(({ peer }) => {
            peer.replaceTrack(
              oldStreamTrack,
              newStreamTrack,
              userStream.current
            );
          });
        });
    }
  };

  return (
    <RoomContainer>
    <MainContent>
      <VideoArea>
        <ParticipantsContainer isScreenSharing={!!screenShareUser}>
          <ParticipantGrid>
            <VideoBox isCurrentUser>
              {userVideoAudio["localUser"].video ? null : (
                <UserName>{currentUser}</UserName>
              )}
              <MyVideo ref={userVideoRef} muted autoPlay playsInline />
              <UserLabel>{currentUser} (You)</UserLabel>
            </VideoBox>
            {peers.map((peer, index, arr) => createUserVideo(peer, index, arr))}
          </ParticipantGrid>
        </ParticipantsContainer>
        <ScreenShareContainer isScreenSharing={!!screenShareUser}>
          {screenShareUser && (
            <ScreenShareBox>
              <PresenterLabel>{screenShareUser} is presenting</PresenterLabel>
              {screenShareUser === currentUser ? (
                <ScreenShareVideo
                  ref={screenShareRef}
                  autoPlay
                  playsInline
                />
              ) : (
                <VideoCard
                  peer={peersRef.current.find(p => p.userName === screenShareUser)?.peer}
                  isScreenSharing={true}
                />
              )}
            </ScreenShareBox>
          )}
        </ScreenShareContainer>
      </VideoArea>
      <BottomBar
        clickScreenSharing={clickScreenSharing}
        clickChat={clickChat}
        clickCameraDevice={clickCameraDevice}
        goToBack={goToBack}
        toggleCameraAudio={toggleCameraAudio}
        userVideoAudio={userVideoAudio["localUser"]}
        screenShare={screenShare}
        videoDevices={videoDevices}
        showVideoDevices={showVideoDevices}
        setShowVideoDevices={setShowVideoDevices}
      />
    </MainContent>
    <ChatContainer display={displayChat}>
      <Chat display={displayChat} roomId={roomId} />
    </ChatContainer>
  </RoomContainer>
);
};

const RoomContainer = styled.div`
display: flex;
width: 100%;
height: 100vh;
background-color: #1a1a1a;
`;

const MainContent = styled.div`
flex: 1;
display: flex;
flex-direction: column;
`;

const VideoArea = styled.div`
flex: 1;
display: flex;
overflow: hidden;
`;

const ParticipantsContainer = styled.div`
flex: ${props => props.isScreenSharing ? "0 0 20%" : "1 0 100%"};
height: 100%;
background-color: #2c2c2c;
transition: all 0.3s ease;
overflow-y: auto;
`;

const ParticipantGrid = styled.div`
display: grid;
grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
gap: 10px;
padding: 10px;
`;

const ScreenShareContainer = styled.div`
flex: ${props => props.isScreenSharing ? "1 0 80%" : "0 0 0%"};
height: 100%;
background-color: #1a1a1a;
transition: all 0.3s ease;
overflow: hidden;
`;

const VideoBox = styled.div`
position: relative;
aspect-ratio: 16 / 9;
background-color: #3c3c3c;
border-radius: 8px;
overflow: hidden;
box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);

${props => props.isCurrentUser && `
  border: 2px solid #4a90e2;
`}
`;

const MyVideo = styled.video`
width: 100%;
height: 100%;
object-fit: cover;
`;

const ScreenShareBox = styled.div`
position: relative;
width: 100%;
height: 100%;
`;

const ScreenShareVideo = styled.video`
width: 100%;
height: 100%;
object-fit: contain;
background-color: #000;
`;

const UserName = styled.div`
position: absolute;
top: 10px;
left: 10px;
color: white;
padding: 5px 10px;
background-color: rgba(0, 0, 0, 0.5);
border-radius: 4px;
font-size: 14px;
`;

const UserLabel = styled.div`
position: absolute;
bottom: 10px;
left: 10px;
color: white;
padding: 5px 10px;
background-color: rgba(0, 0, 0, 0.5);
border-radius: 4px;
font-size: 12px;
`;

const PresenterLabel = styled.div`
position: absolute;
top: 20px;
left: 20px;
color: white;
padding: 8px 16px;
background-color: rgba(74, 144, 226, 0.8);
border-radius: 20px;
font-size: 16px;
font-weight: bold;
z-index: 10;
`;

const ChatContainer = styled.div`
width: ${props => props.display ? "300px" : "0px"};
transition: width 0.3s ease;
overflow: hidden;
`;