import React, {useEffect, useState} from 'react';
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
import {BleManager, Device} from 'react-native-ble-plx';
import {Buffer} from 'buffer';

const SCREEN_WIDTH = Dimensions.get('window').width;

const BLEConnectScreen = () => {
  const [bleManager] = useState(() => new BleManager());
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice1, setConnectedDevice1] = useState<Device | null>(null);
  const [connectedDevice2, setConnectedDevice2] = useState<Device | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [paddleX1, setPaddleX1] = useState(SCREEN_WIDTH / 2 - 50);
  const [paddleX2, setPaddleX2] = useState(SCREEN_WIDTH / 2 - 50);
  const [ballX, setBallX] = useState(SCREEN_WIDTH / 2 - 10); // center horizontally
  const [ballY, setBallY] = useState(150); // starting Y position
  const [ballVX, setBallVX] = useState(10); // velocity X
  const [ballVY, setBallVY] = useState(10); // velocity Y
  const [scorePlayer, setScorePlayer] = useState(0);
  const [scoreOpponent, setScoreOpponent] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [player1Ready, setPlayer1Ready] = useState(false);
  const [player2Ready, setPlayer2Ready] = useState(false);

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
    setLogs(prev => [message, ...prev.slice(0, 30)]);
  };

  const scanForDevices = () => {
    setDevices([]);
    setLogs([]);
    setScanning(true);
    log('🔍 Starting BLE scan...');

    bleManager.startDeviceScan(null, null, (error, scannedDevice) => {
      if (error) {
        log(`❌ Scan error: ${error.message}`);
        setScanning(false);
        return;
      }

      if (scannedDevice?.name) {
        log(`📡 Found: ${scannedDevice.name} (${scannedDevice.id})`);

        setDevices(prev => {
          const exists = prev.find(d => d.id === scannedDevice.id);
          return exists ? prev : [...prev, scannedDevice];
        });
      }
    });

    setTimeout(() => {
      bleManager.stopDeviceScan();
      setScanning(false);
      log('⏹️ Scan stopped after 10s');
    }, 10000);
  };

  const connectToDevice = async (device: Device) => {
    try {
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      log(`✅ Connected to: ${connected.name}`);

      if (!connectedDevice1) {
        setConnectedDevice1(connected);
        monitorDevice(connected, updatePaddle1);
      } else if (
        connectedDevice1.id !== connected.id && //  make sure it's not already device 1
        !connectedDevice2
      ) {
        setConnectedDevice2(connected);
        monitorDevice(connected, updatePaddle2);
      } else {
        log('⚠️ Already connected to this device or both slots are full');
      }
    } catch (err: any) {
      log(`❌ Connection failed: ${err.message}`);
    }
  };

  const sendGameOverToDevices = async () => {
    const message = Buffer.from("GAME_OVER").toString('base64');
  
    try {
      if (connectedDevice1) {
        await connectedDevice1.writeCharacteristicWithResponseForService(
          '47b225e3-f89c-4885-8068-f64092c1b640',
          'beb5483e-36e1-4688-b7f5-ea07361b26a8',
          message
        );
        log("📤 Sent GAME_OVER to Device 1");
      }
  
      if (connectedDevice2) {
        await connectedDevice2.writeCharacteristicWithResponseForService(
          '47b225e3-f89c-4885-8068-f64092c1b640',
          'beb5483e-36e1-4688-b7f5-ea07361b26a8',
          message
        );
        log("📤 Sent GAME_OVER to Device 2");
      }
    } catch (err) {
      log(`❌ Failed to send GAME_OVER: ${err.message}`);
    }
  };

  const resetGame = () => {
    setScorePlayer(0);
    setScoreOpponent(0);
    setGameOver(false);
    setPlayer1Ready(false);
    setPlayer2Ready(false);
    resetBall('down');
  };
  

  const monitorDevice = (
    device: Device,
    paddleUpdater: (accX: number) => void,
  ) => {
    device.monitorCharacteristicForService(
      '47b225e3-f89c-4885-8068-f64092c1b640',
      'beb5483e-36e1-4688-b7f5-ea07361b26a8',
      (error, characteristic) => {
        if (error) {
          log(`💥 BLE Error from ${device.name}: ${error.message}`);
          return;
        }
  
        if (characteristic?.value) {
          const decoded = Buffer.from(characteristic.value, 'base64').toString('utf-8');
          log(`📥 ${device.name} sent: ${decoded}`);
  
          if (decoded.includes("CONFIRM") || decoded.includes("PLAY_AGAIN")) {
            if (device.id === connectedDevice1?.id) {
              setPlayer1Ready(true);
            } else if (device.id === connectedDevice2?.id) {
              setPlayer2Ready(true);
            }
            return;
          }
  
          const match = decoded.match(/X=([-0-9.]+)/);
          if (match) {
            const accX = parseFloat(match[1]);
            paddleUpdater(accX);
          }
        }
      },
    );
  };
  
  const updatePaddle1 = (accX: number) => {
    setPaddleX1(prev => {
      let newX = prev + accX * 2;
      newX = Math.max(0, Math.min(SCREEN_WIDTH - 100, newX));
      return newX;
    });
  };

  const updatePaddle2 = (accX: number) => {
    setPaddleX2(prev => {
      let newX = prev + accX * 2;
      newX = Math.max(0, Math.min(SCREEN_WIDTH - 100, newX));
      return newX;
    });
  };

  const resetBall = (direction: 'up' | 'down') => {
    setBallX(SCREEN_WIDTH / 2 - 10);
    setBallY(150);
    setBallVX(direction === 'up' ? 8 : -8);
    setBallVY(direction === 'up' ? -8 : 8);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setBallX(prevX => {
        const nextX = prevX + ballVX;
        if (nextX <= 0 || nextX >= SCREEN_WIDTH - 20) {
          setBallVX(vx => -vx); // bounce off left/right
        }
        return nextX;
      });

      setBallY(prevY => {
        const nextY = prevY + ballVY;
        const screenHeight = Dimensions.get('window').height;

        const ballTop = nextY;
        const ballBottom = nextY + 20;
        const paddleBottomY = 70;
        const paddleTopY = screenHeight - 70;

        // 🏓 Bounce off bottom paddle
        if (
          ballBottom >= paddleTopY &&
          ballTop <= paddleTopY + 20 &&
          ballX + 20 >= paddleX1 &&
          ballX <= paddleX1 + 100
        ) {
          setBallVY(vy => -vy);
          return prevY + -ballVY;
        }

        // 🏓 Bounce off top paddle
        if (
          ballTop <= paddleBottomY + 20 &&
          ballBottom >= paddleBottomY &&
          ballX + 20 >= paddleX2 &&
          ballX <= paddleX2 + 100
        ) {
          setBallVY(vy => -vy);
          return prevY + -ballVY;
        }

        // ❌ Missed bottom → opponent scores
        if (nextY >= screenHeight - 20) {
          setScoreOpponent(s => {
            const newScore = s + 1;
            if (newScore >= 5) {
              setGameOver(true);
              sendGameOverToDevices(); 
            }
            return newScore;
          });
          resetBall('up');
          return 150;
        }

        // ❌ Missed top → player scores
        if (nextY <= 0) {
          setScorePlayer(s => {
            const newScore = s + 1;
            if (newScore >= 5) {
              setGameOver(true);
              sendGameOverToDevices(); 
            }
            return newScore;
          });
          resetBall('down');
          return 150;
        }

        return nextY;
      });
    }, 16); // 60fps

    return () => clearInterval(interval);
  }, [ballVX, ballVY, paddleX1, paddleX2, ballX]);

  // -----------------------------------
  // UI: Disconnected = scan/connect view
  // -----------------------------------
  if (!connectedDevice1 || !connectedDevice2) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Scan for M5Core Devices</Text>
        <Button
          title={scanning ? 'Scanning...' : 'Scan'}
          onPress={scanForDevices}
          disabled={scanning}
        />
        <Text style={styles.subtitle}>Nearby Devices:</Text>
        <FlatList
          data={devices}
          keyExtractor={item => item.id}
          renderItem={({item}) => (
            <Button
              title={`Connect to ${item.name}`}
              onPress={() => connectToDevice(item)}
            />
          )}
        />
        <Text style={styles.subtitle}>Debug Log:</Text>
        <ScrollView style={styles.logBox}>
          {logs.map((line, index) => (
            <Text key={index} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </ScrollView>
      </View>
    );
  }

  // -----------------------------------
  // UI: Connected = paddle screen
  // -----------------------------------
  if (gameOver) {
    if (player1Ready && player2Ready) {
      resetGame(); // Automatically reset once both confirmed
    }
  
    return (
      <View style={styles.gameOverContainer}>
        <Text style={styles.gameOverText}>🎉 Game Over!!!</Text>
        <Text style={styles.gameOverText}>
          {scorePlayer > scoreOpponent ? '🏆 Player Wins!' : '🤖 Opponent Wins!'}
        </Text>
        <Text style={styles.gameOverText}>
          {player1Ready ? '✅ Player Ready' : '⌛ Player Waiting...'}
        </Text>
        <Text style={styles.gameOverText}>
          {player2Ready ? '✅ Opponent Ready' : '⌛ Opponent Waiting...'}
        </Text>
        <Text style={{ color: '#ccc', marginTop: 20, fontSize: 16 }}>
          Touch "Play Again" on your M5Core2
        </Text>
      </View>
    );
  }
  
  return (
    <View style={styles.gameContainer}>
      <View style={styles.scoreContainer}>
        <Text style={styles.scoreText}>Player: {scorePlayer}</Text>
        <Text style={styles.scoreText}>Opponent: {scoreOpponent}</Text>
      </View>
      {/* Center line */}
      <View style={styles.centerLine} />

      {/* Opponent paddle */}
      <View style={[styles.opponentPaddle, {left: paddleX2}]} />

      {/* Player paddle */}
      <View style={[styles.paddle, {left: paddleX1}]} />

      {/* Ball */}
      <View style={[styles.ball, {left: ballX, top: ballY}]} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, padding: 20, backgroundColor: '#111'},
  title: {fontSize: 22, fontWeight: 'bold', color: 'white', marginBottom: 10},
  subtitle: {color: '#ccc', marginTop: 10},
  logBox: {maxHeight: 200, backgroundColor: '#222', marginTop: 10, padding: 10},
  logLine: {color: '#0f0', fontSize: 12},
  gameContainer: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'flex-end',
    paddingTop: 60,
    paddingBottom: 60,
  },
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

  ball: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'yellow',
    zIndex: 10,
  },
  scoreContainer: {
    position: 'absolute',
    top: '55%',
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    zIndex: 20,
  },
  scoreText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  gameOverContainer: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  gameOverText: {
    color: 'white',
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
});

export default BLEConnectScreen;
