import 'package:flutter/material.dart';

/// One image of a viewer group: [builder] returns the full-size image (loaded lazily, per page).
class ViewerPhoto {
  const ViewerPhoto({required this.builder, this.caption});
  final WidgetBuilder builder;
  final String? caption;
}

/// d1010 (12c / WA-11): fullscreen image viewer shared by every thumbnail (receipts, progress / field /
/// daily-report photos, attendance selfies). Pinch / double-tap zoom, swipe between the images of the same
/// group (swiping is paused while an image is zoomed so panning works).
Future<void> showPhotoViewer(BuildContext context, List<ViewerPhoto> photos, {int initialIndex = 0}) {
  if (photos.isEmpty) return Future.value();
  return showDialog<void>(
    context: context,
    useSafeArea: false,
    builder: (_) => PhotoViewer(photos: photos, initialIndex: initialIndex.clamp(0, photos.length - 1)),
  );
}

class PhotoViewer extends StatefulWidget {
  const PhotoViewer({super.key, required this.photos, this.initialIndex = 0});
  final List<ViewerPhoto> photos;
  final int initialIndex;

  @override
  State<PhotoViewer> createState() => _PhotoViewerState();
}

class _PhotoViewerState extends State<PhotoViewer> {
  late final _pages = PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;
  bool _zoomed = false;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final photos = widget.photos;
    final caption = photos[_index].caption;
    const light = TextStyle(color: Colors.white);
    return Dialog.fullscreen(
      key: const Key('photo-viewer'),
      backgroundColor: Colors.black,
      child: Stack(
        children: [
          PageView.builder(
            controller: _pages,
            physics: _zoomed ? const NeverScrollableScrollPhysics() : const PageScrollPhysics(),
            itemCount: photos.length,
            onPageChanged: (i) => setState(() {
              _index = i;
              _zoomed = false;
            }),
            itemBuilder: (c, i) => _ZoomPage(
              key: ValueKey(i),
              onZoomChanged: (z) {
                if (z != _zoomed) setState(() => _zoomed = z);
              },
              child: photos[i].builder(c),
            ),
          ),
          SafeArea(
            child: Row(
              children: [
                IconButton(
                  key: const Key('photo-viewer-close'),
                  color: Colors.white,
                  tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
                const Spacer(),
                if (photos.length > 1)
                  Padding(
                    padding: const EdgeInsets.only(right: 16),
                    child: Text(
                      '${_index + 1} / ${photos.length}',
                      key: const Key('photo-viewer-counter'),
                      style: light,
                    ),
                  ),
              ],
            ),
          ),
          if (caption != null && caption.isNotEmpty)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: SafeArea(
                child: Container(
                  color: Colors.black54,
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    caption,
                    key: const Key('photo-viewer-caption'),
                    style: light,
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ZoomPage extends StatefulWidget {
  const _ZoomPage({super.key, required this.child, required this.onZoomChanged});
  final Widget child;
  final ValueChanged<bool> onZoomChanged;

  @override
  State<_ZoomPage> createState() => _ZoomPageState();
}

class _ZoomPageState extends State<_ZoomPage> {
  final _ctl = TransformationController();

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  bool get _isZoomed => _ctl.value.getMaxScaleOnAxis() > 1.01;

  void _toggle() {
    _ctl.value = _isZoomed ? Matrix4.identity() : Matrix4.diagonal3Values(2.5, 2.5, 1);
    widget.onZoomChanged(_isZoomed);
  }

  @override
  Widget build(BuildContext context) => GestureDetector(
    onDoubleTap: _toggle,
    child: InteractiveViewer(
      transformationController: _ctl,
      maxScale: 5,
      onInteractionEnd: (_) => widget.onZoomChanged(_isZoomed),
      child: Center(child: widget.child),
    ),
  );
}
