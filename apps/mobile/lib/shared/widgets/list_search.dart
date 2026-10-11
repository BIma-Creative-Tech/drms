import 'dart:async';

import 'package:flutter/material.dart';

import '../../l10n/gen/app_localizations.dart';

/// DRMS 10/10 D8: search box of a list (search icon, clear button). [onChanged] fires 350 ms after the last
/// keystroke (and at once on clear / submit) so a server search is not sent per character.
class ListSearchField extends StatefulWidget {
  const ListSearchField({super.key, required this.onChanged, this.hint, this.initial = ''});
  final ValueChanged<String> onChanged;
  final String? hint;
  final String initial;

  @override
  State<ListSearchField> createState() => _ListSearchFieldState();
}

class _ListSearchFieldState extends State<ListSearchField> {
  late final _c = TextEditingController(text: widget.initial);
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _c.dispose();
    super.dispose();
  }

  void _emit(String v, {bool now = false}) {
    _debounce?.cancel();
    if (now) {
      widget.onChanged(v.trim());
    } else {
      _debounce = Timer(const Duration(milliseconds: 350), () => widget.onChanged(v.trim()));
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return TextField(
      controller: _c,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        isDense: true,
        prefixIcon: const Icon(Icons.search),
        hintText: widget.hint ?? t.searchHint,
        suffixIcon: _c.text.isEmpty
            ? null
            : IconButton(
                tooltip: t.searchClear,
                icon: const Icon(Icons.close),
                onPressed: () {
                  _c.clear();
                  setState(() {});
                  _emit('', now: true);
                },
              ),
      ),
      onChanged: (v) {
        setState(() {});
        _emit(v);
      },
      onSubmitted: (v) => _emit(v, now: true),
    );
  }
}

/// Last row of an infinite list (D8): a spinner that asks for the next page as soon as it is built — i.e. when the
/// list end comes near the viewport, also when the first page does not fill the screen.
class LoadMoreTrigger extends StatefulWidget {
  const LoadMoreTrigger({super.key, required this.onLoad});
  final VoidCallback onLoad;

  @override
  State<LoadMoreTrigger> createState() => _LoadMoreTriggerState();
}

class _LoadMoreTriggerState extends State<LoadMoreTrigger> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onLoad();
    });
  }

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.all(16),
    child: Center(child: SizedBox.square(dimension: 24, child: CircularProgressIndicator(strokeWidth: 2.5))),
  );
}
