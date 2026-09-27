import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

import '../../../l10n/gen/app_localizations.dart';

/// Full-screen capture (ADR 0010 decision 11): rear camera for receipts, FRONT camera only for the
/// attendance selfie (no gallery path; fails closed without that lens). Returns the raw JPEG bytes;
/// compression happens afterwards on the device.
class CameraCaptureScreen extends StatefulWidget {
  const CameraCaptureScreen({super.key, this.lens = CameraLensDirection.back, this.title});
  final CameraLensDirection lens;
  final String? title;

  @override
  State<CameraCaptureScreen> createState() => _CameraCaptureScreenState();
}

class _CameraCaptureScreenState extends State<CameraCaptureScreen> with WidgetsBindingObserver {
  CameraController? _controller;
  String? _error;
  bool _taking = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _init();
  }

  Future<void> _init() async {
    final t = AppLocalizations.of(context);
    try {
      final cams = await availableCameras();
      final cam = cams.where((c) => c.lensDirection == widget.lens).firstOrNull;
      if (cam == null) {
        setState(
          () => _error = widget.lens == CameraLensDirection.front ? t.frontCameraUnavailable : t.cameraUnavailable,
        );
        return;
      }
      final c = CameraController(cam, ResolutionPreset.high, enableAudio: false);
      await c.initialize();
      if (!mounted) {
        await c.dispose();
        return;
      }
      setState(() => _controller = c);
    } on CameraException catch (e) {
      setState(() => _error = e.code.contains('Denied') ? t.cameraPermission : t.cameraUnavailable);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final c = _controller;
    if (c == null || !c.value.isInitialized) return;
    if (state == AppLifecycleState.inactive) {
      _controller = null;
      c.dispose();
    } else if (state == AppLifecycleState.resumed) {
      _init();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _take() async {
    final c = _controller;
    if (c == null || _taking) return;
    setState(() => _taking = true);
    try {
      final file = await c.takePicture();
      final bytes = await file.readAsBytes();
      if (mounted) Navigator.of(context).pop(bytes);
    } on CameraException {
      if (mounted) setState(() => _taking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final c = _controller;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(title: Text(widget.title ?? t.addReceiptCamera)),
      body: _error != null
          ? Center(
              child: Text(_error!, style: const TextStyle(color: Colors.white)),
            )
          : (c == null ? const Center(child: CircularProgressIndicator()) : Center(child: CameraPreview(c))),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
      floatingActionButton: c == null
          ? null
          : FloatingActionButton.large(
              onPressed: _taking ? null : _take,
              tooltip: t.takePhoto,
              child: _taking ? const CircularProgressIndicator() : const Icon(Icons.camera_alt),
            ),
    );
  }
}
