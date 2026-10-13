import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:proyekkas/shared/widgets/form_grid.dart';

/// A text input whose own label is the one the cell hands over (null while the cell shows it on the left).
Widget _field(String key, String? label) => TextField(
  key: Key(key),
  decoration: InputDecoration(labelText: label),
);

/// Reads [FormGridCell.inputLabel] itself, like MasterPickerField / RapItemPickerField.
class _Picker extends StatelessWidget {
  const _Picker({super.key, required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => InputDecorator(
    decoration: InputDecoration(labelText: FormGridCell.inputLabel(context, label)),
    child: const Text('PRJ-1'),
  );
}

class _Form extends StatelessWidget {
  const _Form();

  @override
  Widget build(BuildContext context) => FormGrid(
    children: [
      FormGridCell(label: 'Judul', builder: (label) => _field('f-title', label)),
      const FormGridCell(
        label: 'Project',
        child: _Picker(key: Key('f-project'), label: 'Project'),
      ),
      FormGridCell(label: 'Keterangan', full: true, builder: (label) => _field('f-notes', label)),
      const FormGridCell(
        label: 'Jenis',
        stackedLabel: true,
        child: Text('segmented', key: Key('f-kind')),
      ),
    ],
  );
}

Future<void> _pump(WidgetTester tester, double width) async {
  tester.view.physicalSize = Size(width, 1600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ListView(padding: const EdgeInsets.all(16), children: const [_Form()]),
      ),
    ),
  );
}

String? _inputLabel(WidgetTester tester, String key) {
  final field = tester.widget<TextField>(find.byKey(Key(key)));
  return field.decoration?.labelText;
}

String? _pickerLabel(WidgetTester tester) {
  final decorator = find.descendant(of: find.byKey(const Key('f-project')), matching: find.byType(InputDecorator));
  return tester.widget<InputDecorator>(decorator).decoration.labelText;
}

Offset _at(WidgetTester tester, String key) => tester.getTopLeft(find.byKey(Key(key)));

/// DRMS 13/10 Umum #2 / D4: label left of the input from 600dp, two columns from 900dp, label on top on phones.
void main() {
  test('breakpoints: < 600 stacked, 600–899 label left, ≥ 900 two columns', () {
    expect(FormGridLayout.forWidth(390), FormGridLayout.stacked);
    expect(FormGridLayout.forWidth(599), FormGridLayout.stacked);
    expect(FormGridLayout.forWidth(600), FormGridLayout.labelLeft);
    expect(FormGridLayout.forWidth(899), FormGridLayout.labelLeft);
    expect(FormGridLayout.forWidth(900), FormGridLayout.twoColumns);
    expect(FormGridLayout.forWidth(1280), FormGridLayout.twoColumns);
  });

  testWidgets('phone (390dp): one column, every input keeps its own label on top', (tester) async {
    await _pump(tester, 390);
    expect(_inputLabel(tester, 'f-title'), 'Judul');
    expect(_inputLabel(tester, 'f-notes'), 'Keterangan');
    expect(_pickerLabel(tester), 'Project');
    expect(find.text('Judul'), findsOneWidget, reason: 'no second label next to the input');
    // single column, same left edge
    expect(_at(tester, 'f-project').dy, greaterThan(_at(tester, 'f-title').dy));
    expect(_at(tester, 'f-project').dx, _at(tester, 'f-title').dx);
    expect(_at(tester, 'f-title').dx, 16);
    // a child without an input label gets the label above it
    expect(tester.getTopLeft(find.text('Jenis')).dy, lessThan(_at(tester, 'f-kind').dy));
    expect(tester.getTopLeft(find.text('Jenis')).dx, _at(tester, 'f-kind').dx);
  });

  testWidgets('tablet (700dp): label ≈35% left of the input, top-aligned, one column', (tester) async {
    await _pump(tester, 700);
    expect(_inputLabel(tester, 'f-title'), isNull);
    expect(_pickerLabel(tester), isNull);
    expect(find.text('Judul'), findsOneWidget);
    final label = tester.getRect(find.text('Judul'));
    final input = tester.getRect(find.byKey(const Key('f-title')));
    expect(label.right, lessThanOrEqualTo(input.left));
    expect(input.left, closeTo(16 + 0.35 * (700 - 32), 0.5));
    expect(label.top, greaterThanOrEqualTo(input.top));
    expect(label.top - input.top, lessThan(24), reason: 'top-aligned with the input text');
    expect(_at(tester, 'f-project').dy, greaterThan(input.bottom - 1));
    expect(_at(tester, 'f-project').dx, input.left);
    expect(tester.getTopLeft(find.text('Jenis')).dx, 16);
  });

  testWidgets('wide (1000dp): two cells per row, full-width cells span both, labels line up', (tester) async {
    await _pump(tester, 1000);
    final title = tester.getRect(find.byKey(const Key('f-title')));
    final project = tester.getRect(find.byKey(const Key('f-project')));
    final notes = tester.getRect(find.byKey(const Key('f-notes')));
    expect(project.top, title.top, reason: 'same row');
    expect(project.left, greaterThan(title.right));
    expect(notes.top, greaterThan(title.bottom));
    expect(notes.left, title.left, reason: 'the label of a full-width cell is as wide as in a half cell');
    expect(notes.right, closeTo(1000 - 16, 0.5));
    expect(_inputLabel(tester, 'f-notes'), isNull);
    expect(tester.getTopLeft(find.text('Keterangan')).dx, 16);
  });

  testWidgets('focus order follows the source order (left cell, right cell, next row)', (tester) async {
    await _pump(tester, 1000);
    await tester.tap(find.byKey(const Key('f-title')));
    await tester.pump();
    FocusManager.instance.primaryFocus!.nextFocus();
    await tester.pump();
    final notes = tester.widget<EditableText>(
      find.descendant(of: find.byKey(const Key('f-notes')), matching: find.byType(EditableText)),
    );
    expect(notes.focusNode.hasFocus, isTrue);
  });
}
