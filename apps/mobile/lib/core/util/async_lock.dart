import 'dart:async';

/// Serialises async sections (sync run vs. online submit touch the same drafts).
class AsyncLock {
  Future<void> _tail = Future<void>.value();

  Future<T> run<T>(Future<T> Function() body) {
    final prev = _tail;
    final done = Completer<void>();
    _tail = done.future;
    return prev.then((_) => body()).whenComplete(done.complete);
  }
}
