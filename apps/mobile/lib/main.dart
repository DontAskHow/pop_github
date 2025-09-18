import 'package:flutter/material.dart';

void main() {
  runApp(const PopApp());
}

class PopApp extends StatelessWidget {
  const PopApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'POP MVP',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home: const PopMapPlaceholder(),
    );
  }
}

class PopMapPlaceholder extends StatelessWidget {
  const PopMapPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('POP Map'),
      ),
      body: const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.public, size: 64),
            SizedBox(height: 16),
            Text(
              'Map placeholder — integrate Google Maps widget in M1',
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
