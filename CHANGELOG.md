# Changelog

All notable changes to Paperoo are listed here, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-28

The first release of Paperoo: a PDF editor that runs in your browser. Your files never leave your device.

### Added

- Open a PDF from the file picker, by dragging it in, or try the demo document. The first page shows up quickly, even for large files. ([#21], [#87], [#95], [#11])
- Edit the text already in a PDF. Double-click to change it in place, and it keeps its font, weight, colour and position. This also works for PDFs exported from Figma, text drawn only as outlines, and rotated or stretched text. ([#2], [#7], [#13], [#14], [#15], [#16], [#23], [#25], [#37], [#38], [#39], [#40], [#41], [#42], [#44], [#50], [#51], [#83])
- Move, resize and replace the images and drawings already in a PDF. ([#4], [#5], [#6], [#28], [#49])
- Change a link's text and keep its look. ([#17], [#26], [#27])
- Add your own text, images, drawings, signatures, highlights and shapes, including a dashed line. ([#1], [#54], [#55], [#57], [#58], [#61])
- Copy, cut, paste and duplicate anything you've added. ([#63])
- Fill in PDF forms. Fields are highlighted, required ones are marked, Tab and dropdowns work, and you can clear the whole form. Filled fields look the same in the editor and in the saved file. ([#79], [#80], [#81], [#82])
- Redact text, images and drawings. Redacted content is removed from the exported file, not just covered up. ([#71], [#72], [#73], [#74], [#98])
- Reorder, rotate, delete, duplicate and insert pages, add pages from another PDF, or pull selected pages out into a new PDF. ([#12], [#66], [#67], [#68], [#69], [#70])
- Read scanned pages with text recognition, so you can select and search their text. Press `/` to search. ([#18], [#19], [#45], [#53], [#84])
- Scroll through every page in one view, jump between pages with Page Up and Page Down, and zoom from 10% to 800%. ([#3], [#8], [#10], [#29])
- Undo and redo every change with the usual shortcuts. ([#30], [#32])
- Export or print the edited PDF. If an export fails, you're told instead of left waiting. ([#9], [#36])
- Paperoo saves your unexported edits as you go, offers to restore them next time, and warns you before you close a tab with unsaved work. ([#62], [#64])
- Light and dark themes. Press `M` to switch. ([#56])
- A privacy page explaining that files stay on your device. Strict security settings stop the app from talking to any other site, and page views are counted without cookies. ([#76], [#89], [#90])
- A friendly error screen and a support email for when something goes wrong. Older browsers get a message asking you to update. ([#78], [#86])
- Opens in Safari 18, and can be added to your home screen with proper icons. ([#20], [#59], [#96], [#97])
- Smooth, quick editing on large documents. ([#33], [#34], [#35], [#60])
- Small animations for dropping files, selecting pages, opening panels and pressing buttons. ([#75])

[Unreleased]: https://github.com/wuzgood98/paperoo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/wuzgood98/paperoo/releases/tag/v0.1.0
[#1]: https://github.com/wuzgood98/paperoo/pull/1
[#2]: https://github.com/wuzgood98/paperoo/pull/2
[#3]: https://github.com/wuzgood98/paperoo/pull/3
[#4]: https://github.com/wuzgood98/paperoo/pull/4
[#5]: https://github.com/wuzgood98/paperoo/pull/5
[#6]: https://github.com/wuzgood98/paperoo/pull/6
[#7]: https://github.com/wuzgood98/paperoo/pull/7
[#8]: https://github.com/wuzgood98/paperoo/pull/8
[#9]: https://github.com/wuzgood98/paperoo/pull/9
[#10]: https://github.com/wuzgood98/paperoo/pull/10
[#11]: https://github.com/wuzgood98/paperoo/pull/11
[#12]: https://github.com/wuzgood98/paperoo/pull/12
[#13]: https://github.com/wuzgood98/paperoo/pull/13
[#14]: https://github.com/wuzgood98/paperoo/pull/14
[#15]: https://github.com/wuzgood98/paperoo/pull/15
[#16]: https://github.com/wuzgood98/paperoo/pull/16
[#17]: https://github.com/wuzgood98/paperoo/pull/17
[#18]: https://github.com/wuzgood98/paperoo/pull/18
[#19]: https://github.com/wuzgood98/paperoo/pull/19
[#20]: https://github.com/wuzgood98/paperoo/pull/20
[#21]: https://github.com/wuzgood98/paperoo/pull/21
[#23]: https://github.com/wuzgood98/paperoo/pull/23
[#25]: https://github.com/wuzgood98/paperoo/pull/25
[#26]: https://github.com/wuzgood98/paperoo/pull/26
[#27]: https://github.com/wuzgood98/paperoo/pull/27
[#28]: https://github.com/wuzgood98/paperoo/pull/28
[#29]: https://github.com/wuzgood98/paperoo/pull/29
[#30]: https://github.com/wuzgood98/paperoo/pull/30
[#32]: https://github.com/wuzgood98/paperoo/pull/32
[#33]: https://github.com/wuzgood98/paperoo/pull/33
[#34]: https://github.com/wuzgood98/paperoo/pull/34
[#35]: https://github.com/wuzgood98/paperoo/pull/35
[#36]: https://github.com/wuzgood98/paperoo/pull/36
[#37]: https://github.com/wuzgood98/paperoo/pull/37
[#38]: https://github.com/wuzgood98/paperoo/pull/38
[#39]: https://github.com/wuzgood98/paperoo/pull/39
[#40]: https://github.com/wuzgood98/paperoo/pull/40
[#41]: https://github.com/wuzgood98/paperoo/pull/41
[#42]: https://github.com/wuzgood98/paperoo/pull/42
[#44]: https://github.com/wuzgood98/paperoo/pull/44
[#45]: https://github.com/wuzgood98/paperoo/pull/45
[#49]: https://github.com/wuzgood98/paperoo/pull/49
[#50]: https://github.com/wuzgood98/paperoo/pull/50
[#51]: https://github.com/wuzgood98/paperoo/pull/51
[#53]: https://github.com/wuzgood98/paperoo/pull/53
[#54]: https://github.com/wuzgood98/paperoo/pull/54
[#55]: https://github.com/wuzgood98/paperoo/pull/55
[#56]: https://github.com/wuzgood98/paperoo/pull/56
[#57]: https://github.com/wuzgood98/paperoo/pull/57
[#58]: https://github.com/wuzgood98/paperoo/pull/58
[#59]: https://github.com/wuzgood98/paperoo/pull/59
[#60]: https://github.com/wuzgood98/paperoo/pull/60
[#61]: https://github.com/wuzgood98/paperoo/pull/61
[#62]: https://github.com/wuzgood98/paperoo/pull/62
[#63]: https://github.com/wuzgood98/paperoo/pull/63
[#64]: https://github.com/wuzgood98/paperoo/pull/64
[#66]: https://github.com/wuzgood98/paperoo/pull/66
[#67]: https://github.com/wuzgood98/paperoo/pull/67
[#68]: https://github.com/wuzgood98/paperoo/pull/68
[#69]: https://github.com/wuzgood98/paperoo/pull/69
[#70]: https://github.com/wuzgood98/paperoo/pull/70
[#71]: https://github.com/wuzgood98/paperoo/pull/71
[#72]: https://github.com/wuzgood98/paperoo/pull/72
[#73]: https://github.com/wuzgood98/paperoo/pull/73
[#74]: https://github.com/wuzgood98/paperoo/pull/74
[#75]: https://github.com/wuzgood98/paperoo/pull/75
[#76]: https://github.com/wuzgood98/paperoo/pull/76
[#78]: https://github.com/wuzgood98/paperoo/pull/78
[#79]: https://github.com/wuzgood98/paperoo/pull/79
[#80]: https://github.com/wuzgood98/paperoo/pull/80
[#81]: https://github.com/wuzgood98/paperoo/pull/81
[#82]: https://github.com/wuzgood98/paperoo/pull/82
[#83]: https://github.com/wuzgood98/paperoo/pull/83
[#84]: https://github.com/wuzgood98/paperoo/pull/84
[#86]: https://github.com/wuzgood98/paperoo/pull/86
[#87]: https://github.com/wuzgood98/paperoo/pull/87
[#89]: https://github.com/wuzgood98/paperoo/pull/89
[#90]: https://github.com/wuzgood98/paperoo/pull/90
[#95]: https://github.com/wuzgood98/paperoo/pull/95
[#96]: https://github.com/wuzgood98/paperoo/pull/96
[#97]: https://github.com/wuzgood98/paperoo/pull/97
[#98]: https://github.com/wuzgood98/paperoo/pull/98
