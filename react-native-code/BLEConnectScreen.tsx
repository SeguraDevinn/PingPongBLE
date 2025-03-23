import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Button,
  PermissionsAndroid,
  Platform,
  FlatList,
  ScrollView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

const SCREEN_WIDTH = Dimensions.get('window').width;

const BLEConnectScreen = () => {
  const [bleManager] = useState(() => new BleManager());
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [paddleX, setPaddleX] = useState(SCREEN_WIDTH / 2 - 50);

  useEffect(() => {
    if (Platform.OS === 'android') {
      PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
    }

    return () => {
      bleManager.destroy();
    };
  }, []);

  const log = (message: string) => {
    console.log(message);
    setLogs((prev) => [message, ...prev.slice(0, 30)]);
  };

  const scanForDevices = () => {
    setDevices([]);
    setLogs([]);
    setScanning(true);
    log("🔍 Starting BLE scan...");

    bleManager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error) {
        log(`❌ Scan error: ${error.message}`);
        setScanning(false);
        return;
      }

      if (scannedDevice?.name) {
        log(`📡 Found: ${scannedDevice.name} (${scannedDevice.id})`);

        setDevices((prev) => {
          const exists = prev.find((d) => d.id === scannedDevice.id);
          return exists ? prev : [...prev, scannedDevice];
        });
      }
    });

    setTimeout(() => {
      bleManager.stopDeviceScan();
      setScanning(false);
      log("⏹️ Scan stopped after 10s");
    }, 10000);
  };

  const connectToDevice = async (device: Device) => {
    try {
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      log(`✅ Connected to: ${connected.name}`);
      setConnectedDevice(connected);

      connected.monitorCharacteristicForService(
        "47b225e3-f89c-4885-8068-f64092c1b640",
        "beb5483e-36e1-4688-b7f5-ea07361b26a8",
        (error, characteristic) => {
          if (error) {
            log(`💥 BLE Error: ${error.message}`);
            setConnectedDevice(null);
            return;
          }

          if (characteristic?.value) {
            const decoded = Buffer.from(characteristic.value, 'base64').toString('utf-8');
            log(`📥 Received: ${decoded}`);
            const match = decoded.match(/X=([-0-9.]+)/);
            if (match) {
              const accX = parseFloat(match[1]);
              updatePaddle(accX);
            }
          }
        }
      );
    } catch (err: any) {
      log(`❌ Connection failed: ${err.message}`);
    }
  };

  const updatePaddle = (accX: number) => {
    setPaddleX((prev) => {
      let newX = prev + accX * 2;
      newX = Math.max(0, Math.min(SCREEN_WIDTH - 100, newX));
      return newX;
    });
  };

  // -----------------------------------
  // UI: Disconnected = scan/connect view
  // -----------------------------------
  if (!connectedDevice) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Scan for M5Core Devices</Text>
        <Button title={scanning ? "Scanning..." : "Scan"} onPress={scanForDevices} disabled={scanning} />
        <Text style={styles.subtitle}>Nearby Devices:</Text>
        <FlatList
          data={devices}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Button title={`Connect to ${item.name}`} onPress={() => connectToDevice(item)} />
          )}
        />
        <Text style={styles.subtitle}>Debug Log:</Text>
        <ScrollView style={styles.logBox}>
          {logs.map((line, index) => (
            <Text key={index} style={styles.logLine}>{line}</Text>
          ))}
        </ScrollView>
      </View>
    );
  }

  // -----------------------------------
  // UI: Connected = paddle screen
  // -----------------------------------
  return (
    <View style={styles.gameContainer}>
    <Text style={styles.title}>Connected to {connectedDevice.name}</Text>

    {/* Center line */}
    <View style={styles.centerLine} />

    {/* Opponent paddle */}
    <View style={[styles.opponentPaddle, { left: SCREEN_WIDTH / 2 - 50 }]} />

    {/* Player paddle */}
    <View style={[styles.paddle, { left: paddleX }]} />
  </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#111' },
  title: { fontSize: 22, fontWeight: 'bold', color: 'white', marginBottom: 10 },
  subtitle: { color: '#ccc', marginTop: 10 },
  logBox: { maxHeight: 200, backgroundColor: '#222', marginTop: 10, padding: 10 },
  logLine: { color: '#0f0', fontSize: 12 },
  gameContainer: { flex: 1, backgroundColor: 'black', justifyContent: 'flex-end' },
  paddle: {
    position: 'absolute',
    bottom: 50,
    width: 100,
    height: 20,
    backgroundColor: 'white',
    borderRadius: 10,
  },
  centerLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#555',
    top: '50%',
  },
  
  opponentPaddle: {
    position: 'absolute',
    top: 50,
    width: 100,
    height: 20,
    backgroundColor: 'red',
    borderRadius: 10,
  },
  
});

export default BLEConnectScreen;
