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

// Get screen width for layout calculations
const SCREEN_WIDTH = Dimensions.get('window').width;

const BLEConnectScreen = () => {
  // -------------------------------
  // BLE and Game State
  // -------------------------------
  const [bleManager] = useState(() => new BleManager());
  const [devices, setDevices] = useState<Device[]>([]); // Discovered BLE devices
  const [connectedDevice1, setConnectedDevice1] = useState<Device | null>(null);
  const [connectedDevice2, setConnectedDevice2] = useState<Device | null>(null);
  const [logs, setLogs] = useState<string[]>([]); // Debug log lines
  const [scanning, setScanning] = useState(false);
  
  // Game states: paddle positions, ball physics, score and game over flags
  const [paddleX1, setPaddleX1] = useState(SCREEN_WIDTH / 2 - 50);
  const [paddleX2, setPaddleX2] = useState(SCREEN_WIDTH / 2 - 50);
  const [ballX, setBallX] = useState(SCREEN_WIDTH / 2 - 10); // center horizontally
  const [ballY, setBallY] = useState(150); // starting Y position
  const [ballVX, setBallVX] = useState(10); // velocity in X direction
  const [ballVY, setBallVY] = useState(10); // velocity in Y direction
  const [scorePlayer, setScorePlayer] = useState(0);
  const [scoreOpponent, setScoreOpponent] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  // Flags to track if each connected device has confirmed a "Play Again" request
  const [player1Ready, setPlayer1Ready] = useState(false);
  const [player2Ready, setPlayer2Ready] = useState(false);

  // -------------------------------
  // Request Permissions (Android)
  // -------------------------------
  useEffect(() => {
    if (Platform.OS === 'android') {
      PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
    }
    // Cleanup BLE manager on unmount
    return () => {
      bleManager.destroy();
    };
  }, []);

  // -------------------------------
  // Logging Helper Function
  // -------------------------------
  const log = (message: string) => {
    console.log(message);
    setLogs(prev => [message, ...prev.slice(0, 30)]);
  };

  // -------------------------------
  // BLE Device Scanning
  // -------------------------------
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
      // If device has a name, add to list
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

  // -------------------------------
  // Connect to a Selected Device
  // -------------------------------
  const connectToDevice = async (device: Device) => {
    try {
      const connected = await device.connect();
      await connected.discoverAllServicesAndCharacteristics();
      log(`✅ Connected to: ${connected.name}`);

      // Assign device to player slots (ensure no duplicate)
      if (!connectedDevice1) {
        setConnectedDevice1(connected);
        monitorDevice(connected, updatePaddle1);
      } else if (
        connectedDevice1.id !== connected.id &&
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

  // -------------------------------
  // Send GAME_OVER Command to Devices
  // -------------------------------
  // Called when either player reaches 5 points.
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
    } catch (err: any) {
      log(`❌ Failed to send GAME_OVER: ${err.message}`);
    }
  };

  // -------------------------------
  // Reset Game State
  // -------------------------------
  const resetGame = () => {
    setScorePlayer(0);
    setScoreOpponent(0);
    setGameOver(false);
    setPlayer1Ready(false);
    setPlayer2Ready(false);
    resetBall('down');
  };

  // -------------------------------
  // Monitor a Connected Device for BLE Data
  // -------------------------------
  // This function listens to incoming BLE messages from a device,
  // updates the corresponding paddle via paddleUpdater, and checks
  // for confirmation messages ("CONFIRM" or "PLAY_AGAIN").
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

          // Check for confirmation messages from M5Core devices
          if (decoded.includes("CONFIRM") || decoded.includes("PLAY_AGAIN")) {
            if (device.id === connectedDevice1?.id) {
              setPlayer1Ready(true);
            } else if (device.id === connectedDevice2?.id) {
              setPlayer2Ready(true);
            }
            return;
          }

          // Extract motion data (assumes format "X=...") and update paddle position
          const match = decoded.match(/X=([-0-9.]+)/);
          if (match) {
            const accX = parseFloat(match[1]);
            paddleUpdater(accX);
          }
        }
      },
    );
  };

  // -------------------------------
  // Paddle Updaters
  // -------------------------------
  // Each device controls its paddle by sending an acceleration in X.
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

  // -------------------------------
  // Reset Ball Position and Velocity
  // -------------------------------
  // Called after a score or when resetting the game.
  const resetBall = (direction: 'up' | 'down') => {
    setBallX(SCREEN_WIDTH / 2 - 10);
    setBallY(150);
    setBallVX(direction === 'up' ? 8 : -8);
    setBallVY(direction === 'up' ? -8 : 8);
  };

  // -------------------------------
  // Game Physics: Ball Movement and Collision
  // -------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      // Update ball's X position
      setBallX(prevX => {
        const nextX = prevX + ballVX;
        // Bounce off left/right walls
        if (nextX <= 0 || nextX >= SCREEN_WIDTH - 20) {
          setBallVX(vx => -vx);
        }
        return nextX;
      });

      // Update ball's Y position and check for collisions and scoring
      setBallY(prevY => {
        const nextY = prevY + ballVY;
        const screenHeight = Dimensions.get('window').height;

        const ballTop = nextY;
        const ballBottom = nextY + 20;
        const paddleBottomY = 70;            // Top paddle's Y coordinate (opponent)
        const paddleTopY = screenHeight - 70;  // Bottom paddle's Y coordinate (player)

        // Bounce off bottom paddle (player)
        if (
          ballBottom >= paddleTopY &&
          ballTop <= paddleTopY + 20 &&
          ballX + 20 >= paddleX1 &&
          ballX <= paddleX1 + 100
        ) {
          setBallVY(vy => -vy);
          return prevY + -ballVY;
        }

        // Bounce off top paddle (opponent)
        if (
          ballTop <= paddleBottomY + 20 &&
          ballBottom >= paddleBottomY &&
          ballX + 20 >= paddleX2 &&
          ballX <= paddleX2 + 100
        ) {
          setBallVY(vy => -vy);
          return prevY + -ballVY;
        }

        // Missed bottom paddle: Opponent scores
        if (nextY >= screenHeight - 20) {
          setScoreOpponent(s => {
            const newScore = s + 1;
            if (newScore >= 5) {
              setGameOver(true);
              sendGameOverToDevices(); // Notify devices of game over
            }
            return newScore;
          });
          resetBall('up');
          return 150;
        }

        // Missed top paddle: Player scores
        if (nextY <= 0) {
          setScorePlayer(s => {
            const newScore = s + 1;
            if (newScore >= 5) {
              setGameOver(true);
              sendGameOverToDevices(); // Notify devices of game over
            }
            return newScore;
          });
          resetBall('down');
          return 150;
        }

        return nextY;
      });
    }, 16); // ~60fps

    return () => clearInterval(interval);
  }, [ballVX, ballVY, paddleX1, paddleX2, ballX]);

  // -------------------------------
  // UI: When Not All Devices are Connected (Scan View)
  // -------------------------------
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
          renderItem={({ item }) => (
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

  // -------------------------------
  // UI: Game Over Screen
  // -------------------------------
  if (gameOver) {
    // If both devices have confirmed "PLAY_AGAIN", reset the game
    if (player1Ready && player2Ready) {
      resetGame();
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

  // -------------------------------
  // UI: Main Game Screen (When Both Devices are Connected)
  // -------------------------------
  return (
    <View style={styles.gameContainer}>
      {/* Scoreboard */}
      <View style={styles.scoreContainer}>
        <Text style={styles.scoreText}>Player: {scorePlayer}</Text>
        <Text style={styles.scoreText}>Opponent: {scoreOpponent}</Text>
      </View>
      {/* Center Line */}
      <View style={styles.centerLine} />

      {/* Opponent Paddle (Top) */}
      <View style={[styles.opponentPaddle, { left: paddleX2 }]} />

      {/* Player Paddle (Bottom) */}
      <View style={[styles.paddle, { left: paddleX1 }]} />

      {/* Ball */}
      <View style={[styles.ball, { left: ballX, top: ballY }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  // Scan screen styles
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#111',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 10,
  },
  subtitle: {
    color: '#ccc',
    marginTop: 10,
  },
  logBox: {
    maxHeight: 200,
    backgroundColor: '#222',
    marginTop: 10,
    padding: 10,
  },
  logLine: {
    color: '#0f0',
    fontSize: 12,
  },
  // Game screen styles
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
  // Game Over screen styles
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
