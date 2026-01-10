import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Image,
  ScrollView,
  Dimensions
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import { MaterialIcons, FontAwesome, Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export const CameraScreen: React.FC = () => {
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<'on' | 'off'>('off');
  const [permission, requestPermission] = useCameraPermissions();
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [photos, setPhotos] = useState<Array<{ uri: string; location: any }>>([]);
  const [isRecording, setIsRecording] = useState(false);
  
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    (async () => {
      // Solicitar permissões
      const { status: cameraStatus } = await requestPermission();
      const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
      const { status: mediaStatus } = await MediaLibrary.requestPermissionsAsync();

      if (cameraStatus !== 'granted' || locationStatus !== 'granted') {
        Alert.alert('Permissão necessária', 'É necessário permitir o acesso à câmera e localização.');
      }

      // Obter localização atual
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      setLocation(location);
    })();
  }, []);

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const toggleFlash = () => {
    setFlash(current => (current === 'off' ? 'on' : 'off'));
  };

  const takePicture = async () => {
    if (!cameraRef.current) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
        exif: true
      });

      // Adicionar localização aos metadados
      const photoWithLocation = {
        uri: photo.uri,
        location: location?.coords,
        timestamp: new Date().toISOString()
      };

      setPhotos(prev => [photoWithLocation, ...prev]);

      // Salvar na galeria
      await MediaLibrary.saveToLibraryAsync(photo.uri);

      Alert.alert('Sucesso', 'Foto capturada e salva!');
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível capturar a foto.');
    }
  };

  const recordVideo = async () => {
    if (!cameraRef.current) return;

    try {
      if (!isRecording) {
        setIsRecording(true);
        const video = await cameraRef.current.recordAsync({
          maxDuration: 60, // 1 minuto máximo
          quality: '720p'
        });

        // Processar vídeo
        Alert.alert('Vídeo gravado', `Duração: ${video.duration}ms`);
      } else {
        cameraRef.current.stopRecording();
        setIsRecording(false);
      }
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível gravar o vídeo.');
      setIsRecording(false);
    }
  };

  const addLocationToPhotos = async () => {
    try {
      const newLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      setLocation(newLocation);
      Alert.alert('Localização atualizada', 'As próximas fotos terão esta localização.');
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível obter a localização.');
    }
  };

  const uploadPhotos = async () => {
    // Implementar upload para o backend
    Alert.alert('Upload', `Enviando ${photos.length} fotos...`);
  };

  if (!permission?.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>
          É necessário permitir o acesso à câmera.
        </Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Conceder Permissão</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash}
        enableTorch={flash === 'on'}
      >
        <View style={styles.overlay}>
          <View style={styles.locationBar}>
            {location ? (
              <Text style={styles.locationText}>
                📍 {location.coords.latitude.toFixed(4)}, {location.coords.longitude.toFixed(4)}
              </Text>
            ) : (
              <Text style={styles.locationText}>Obtendo localização...</Text>
            )}
            <TouchableOpacity onPress={addLocationToPhotos}>
              <Ionicons name="refresh" size={24} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.controlButton} onPress={toggleFlash}>
          <MaterialIcons
            name={flash === 'on' ? 'flash-on' : 'flash-off'}
            size={30}
            color="white"
          />
        </TouchableOpacity>

        <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
          <View style={styles.captureButtonInner} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={toggleCameraFacing}>
          <Ionicons name="camera-reverse" size={30} color="white" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={recordVideo}>
          <FontAwesome
            name={isRecording ? 'stop-circle' : 'video-camera'}
            size={30}
            color={isRecording ? 'red' : 'white'}
          />
        </TouchableOpacity>
      </View>

      {photos.length > 0 && (
        <View style={styles.galleryContainer}>
          <Text style={styles.galleryTitle}>Fotos Capturadas ({photos.length})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {photos.map((photo, index) => (
              <TouchableOpacity key={index} style={styles.photoThumbnail}>
                <Image source={{ uri: photo.uri }} style={styles.thumbnailImage} />
                {photo.location && (
                  <View style={styles.photoBadge}>
                    <Ionicons name="location" size={12} color="white" />
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.uploadButton} onPress={uploadPhotos}>
            <Text style={styles.uploadButtonText}>Upload para Laudo</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000'
  },
  camera: {
    flex: 1
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent'
  },
  locationBar: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.5)'
  },
  locationText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600'
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: 'rgba(0,0,0,0.7)'
  },
  controlButton: {
    padding: 15
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center'
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'transparent',
    borderWidth: 3,
    borderColor: 'black'
  },
  galleryContainer: {
    backgroundColor: 'white',
    padding: 15,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20
  },
  galleryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10
  },
  photoThumbnail: {
    width: 80,
    height: 80,
    marginRight: 10,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative'
  },
  thumbnailImage: {
    width: '100%',
    height: '100%'
  },
  photoBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: '#1e3c72',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center'
  },
  uploadButton: {
    backgroundColor: '#1e3c72',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10
  },
  uploadButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16
  },
  message: {
    color: 'white',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20
  },
  button: {
    backgroundColor: '#1e3c72',
    padding: 15,
    borderRadius: 8
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold'
  }
});