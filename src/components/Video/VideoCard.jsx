import React, { useEffect, useRef } from 'react';
import styled from 'styled-components';

const VideoCard = ({ peer, isScreenSharing }) => {
  const ref = useRef();

  useEffect(() => {
    peer.on('stream', (stream) => {
      console.log('Received remote stream');
      ref.current.srcObject = stream;
    });
  
    return () => peer.off('stream');
  }, [peer]);

  return (
    <Video
      ref={ref}
      autoPlay
      playsInline
      muted={isScreenSharing}
      style={{ objectFit: isScreenSharing ? 'contain' : 'cover' }}
    />
  );
};

const Video = styled.video`
  width: 100%;
  height: 100%;
`;

export default VideoCard;