import { useState, useRef, useEffect } from 'react';

interface UseCameraOptions {
  facingMode?: 'user' | 'environment';
  onCapture?: (imageData: string) => void;
}

export const useCamera = (options: UseCameraOptions = {}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [flash, setFlash] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = async () => {
    try {
      setError(null);
      
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: options.facingMode || 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(mediaStream);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      setIsCameraReady(true);
    } catch (err: any) {
      setError(`Erro ao acessar câmera: ${err.message}`);
      setIsCameraReady(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setIsCameraReady(false);
    }
  };

  const capturePhoto = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Ajustar tamanho do canvas
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const context = canvas.getContext('2d');
    if (!context) return null;

    // Desenhar frame no canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Aplicar efeito de flash se ativo
    if (flash) {
      context.fillStyle = 'rgba(255, 255, 255, 0.7)';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Converter para data URL
    const imageData = canvas.toDataURL('image/jpeg', 0.9);
    
    // Chamar callback se fornecido
    if (options.onCapture) {
      options.onCapture(imageData);
    }

    return imageData;
  };

  const switchCamera = () => {
    stopCamera();
    const newFacingMode = options.facingMode === 'user' ? 'environment' : 'user';
    startCamera();
  };

  const toggleFlash = () => {
    setFlash(!flash);
    // Em dispositivos móveis, controlar flash real
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack.getCapabilities && videoTrack.getCapabilities().torch) {
        videoTrack.applyConstraints({
          advanced: [{ torch: !flash } as any]
        });
      }
    }
  };

  // Limpar ao desmontar
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    stream,
    error,
    isCameraReady,
    flash,
    startCamera,
    stopCamera,
    capturePhoto,
    switchCamera,
    toggleFlash
  };
};