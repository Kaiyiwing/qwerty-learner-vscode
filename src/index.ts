import { dictionaries } from './resource/dictionary'
import { DictPickItem } from './typings/index'
import * as vscode from 'vscode'
import { range } from 'lodash'
import { getConfig } from './utils'
import { soundPlayer } from './sound'
import { voicePlayer } from './resource/voice'
import PluginState from './utils/PluginState'
import * as fs from 'fs';
import * as path from 'path';

const PLAY_VOICE_COMMAND = 'qwerty-learner.playVoice'
const PREV_WORD_COMMAND = 'qwerty-learner.prevWord'
const NEXT_WORD_COMMAND = 'qwerty-learner.nextWord'
const TOGGLE_TRANSLATION_COMMAND = 'qwerty-learner.toggleTranslation'
const TOGGLE_DIC_NAME_COMMAND = 'qwerty-learner.toggleDicName'
const OPEN_WRONG_WORDS_COMMAND = 'qwerty-learner.openWrongWords'

export function activate(context: vscode.ExtensionContext) {
  const pluginState = new PluginState(context)

  const wordBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100)
  const inputBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -101)
  const playVoiceBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -102)
  const translationBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -103)
  const prevWord = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -104)
  const nextWord = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -105)
  const wrongWords = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -106)
  prevWord.text = '<'
  prevWord.tooltip = '切换上一个单词'
  prevWord.command = PREV_WORD_COMMAND
  nextWord.text = '>'
  nextWord.tooltip = '切换下一个单词'
  nextWord.command = NEXT_WORD_COMMAND
  playVoiceBar.command = PLAY_VOICE_COMMAND
  playVoiceBar.tooltip = '播放发音'
  translationBar.tooltip = '显示/隐藏中文翻译'
  translationBar.command = TOGGLE_TRANSLATION_COMMAND
  wordBar.command = TOGGLE_DIC_NAME_COMMAND
  wordBar.tooltip = '隐藏/显示字典名称'
  wrongWords.text = '错词本'
  wrongWords.tooltip = '点击打开错词本'
  wrongWords.command = OPEN_WRONG_WORDS_COMMAND

  function logWrongWord(word: string, translation: string) {
    const filePath = path.join(__dirname, 'wrong_words.txt');

    let fileContent = '';
    try {
        fileContent = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    const lines = fileContent.split('\n').filter(line => line.trim() !== '');
    const wordMap: { [key: string]: { translation: string, count: number } } = {};
    lines.forEach(line => {
        const parts = line.split(' ');
        const count = parseInt(parts.pop()!, 10);
        const translation = parts.pop()!;
        const word = parts.join(' ');
        wordMap[word] = { translation, count };
    });

    if (wordMap[word]) {
        wordMap[word].count += 1;
    } else {
        wordMap[word] = { translation, count: 1 };
    }

    const newLines = Object.keys(wordMap)
        .map(word => `${word} ${wordMap[word].translation} ${wordMap[word].count}`)
        .sort((a, b) => {
            const countA = parseInt(a.split(' ').pop()!, 10);
            const countB = parseInt(b.split(' ').pop()!, 10);
            return countB - countA;
        });

    fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
    console.log(`单词 "${word}" 和翻译 "${translation}" 已记录.`);
}




vscode.workspace.onDidChangeTextDocument((e) => {
  if (!pluginState.isStart) {
      return;
  }

  if (pluginState.readOnlyMode) {
      return;
  }

  const { uri } = e.document;

  if (uri.scheme.indexOf('vscode') !== -1) {
      return;
  }

  const { range, text, rangeLength } = e.contentChanges[0];

  if (!(text !== '' && text.length === 1)) {
      return;
  }

  const newRange = new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character + 1);
  const editAction = new vscode.WorkspaceEdit();
  editAction.delete(uri, newRange);
  vscode.workspace.applyEdit(editAction);

  if (pluginState.hasWrong) {
      return;
  }

  soundPlayer('click');
  inputBar.text = pluginState.getCurrentInputBarContent(text);

  const compareResult = pluginState.compareResult;

  if (compareResult === -2) {
      soundPlayer('success');
      pluginState.finishWord();
      initializeBar();
  } else if (compareResult >= 0) {
      pluginState.wrongInput();
      inputBar.color = pluginState.highlightWrongColor;
      soundPlayer('wrong');

      // 调用记录正确单词和翻译的函数
      const currentWord = pluginState.getCurrentWord();
      const translation = pluginState.getCurrentTranslation()
      logWrongWord(currentWord, translation);

      setTimeout(() => {
          pluginState.clearWrong();
          inputBar.color = undefined;
          initializeBar();
      }, pluginState.highlightWrongDelay);
  }e
});


  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('qwerty-learner.placeholder')) {
      pluginState.placeholder = getConfig('placeholder')
      initializeBar()
    }

    if (event.affectsConfiguration('qwerty-learner.chapterLength')) {
      pluginState.chapterLength = getConfig('chapterLength')
      initializeBar()
    }
  })

  // 注册 vscode commands
  context.subscriptions.push(
    ...[
      vscode.commands.registerCommand('qwerty-learner.start', () => {
        pluginState.isStart = !pluginState.isStart
        if (pluginState.isStart) {
          initializeBar()
          wordBar.show()
          inputBar.show()
          playVoiceBar.show()
          prevWord.show()
          nextWord.show()
          translationBar.show()
          wrongWords.show()
          if (pluginState.readOnlyMode) {
            setUpReadOnlyInterval()
          }
        } else {
          wordBar.hide()
          inputBar.hide()
          playVoiceBar.hide()
          prevWord.hide()
          nextWord.hide()
          translationBar.hide()
          wrongWords.hide()
          removeReadOnlyInterval()
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.changeChapter', async () => {
        const inputChapter = await vscode.window.showQuickPick(
          range(1, pluginState.totalChapters + 1).map((i) => i.toString()),
          { placeHolder: `当前章节: ${pluginState.chapter + 1}   共 ${pluginState.totalChapters}章节` },
        )
        if (inputChapter !== undefined) {
          pluginState.chapter = parseInt(inputChapter) - 1
          initializeBar()
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.changeDict', async () => {
        const dictList: DictPickItem[] = []
        dictionaries.forEach((dict) => {
          dictList.push({ label: dict.name, path: dict.url, detail: dict.description, key: dict.id })
        })
        const inputDict = await vscode.window.showQuickPick(dictList, { placeHolder: `当前字典: ${pluginState.dict.name}` })
        if (inputDict !== undefined) {
          pluginState.dictKey = inputDict.key
          initializeBar()
        }
      }),
      vscode.commands.registerCommand('qwerty-learner.toggleWordVisibility', () => {
        pluginState.wordVisibility = !pluginState.wordVisibility
        initializeBar()
      }),
      vscode.commands.registerCommand('qwerty-learner.toggleReadOnlyMode', () => {
        pluginState.readOnlyMode = !pluginState.readOnlyMode
        if (pluginState.readOnlyMode) {
          setUpReadOnlyInterval()
        } else {
          removeReadOnlyInterval()
        }
      }),
      vscode.commands.registerCommand(PLAY_VOICE_COMMAND, playVoice),
      vscode.commands.registerCommand(TOGGLE_TRANSLATION_COMMAND, () => {
        pluginState.toggleTranslation()
        initializeBar()
      }),
      vscode.commands.registerCommand(TOGGLE_DIC_NAME_COMMAND, () => {
        pluginState.toggleDictName()
        wordBar.text = pluginState.getInitialWordBarContent()
      }),
      vscode.commands.registerCommand(PREV_WORD_COMMAND, () => {
        pluginState.prevWord()
        initializeBar()
      }),
      vscode.commands.registerCommand(NEXT_WORD_COMMAND, () => {
        pluginState.nextWord()
        initializeBar()
      }),
      vscode.commands.registerCommand('qwerty-learner.toggleChapterCycleMode', () => {
        pluginState.chapterCycleMode = !pluginState.chapterCycleMode
        if (pluginState.chapterCycleMode) {
          vscode.window.showInformationMessage('章节循环模式已开启')
        } else {
          vscode.window.showInformationMessage('章节循环模式已关闭')
        }
      }),
      // 注册打开错词本的命令
      vscode.commands.registerCommand(OPEN_WRONG_WORDS_COMMAND, () => {
        const filePath = path.join(__dirname, 'wrong_words.txt');
        fs.exists(filePath, (exists) => {
          if (!exists) {
            fs.writeFile(filePath, '', (error) => {})
          }
        });

        vscode.workspace.openTextDocument(filePath).then(doc => {
            vscode.window.showTextDocument(doc);
        });
    })
    ],
  )

  function initializeBar() {
    setUpWordBar()
    setUpPlayVoiceBar()
    setUpTranslationBar()
    setUpInputBar()
  }
  function playVoice() {
    if (pluginState.shouldPlayVoice) {
      pluginState.voiceLock = true
      voicePlayer(pluginState.currentWord.name, () => {
        pluginState.voiceLock = false
      })
    }
  }
  
  function setUpWordBar() {
    wordBar.text = pluginState.getInitialWordBarContent()
    playVoice()
  }
  function setUpPlayVoiceBar() {
    playVoiceBar.text = pluginState.getInitialPlayVoiceBarContent()
  }
  function setUpTranslationBar() {
    translationBar.text = pluginState.getInitialTranslationBarContent()
  }
  function setUpInputBar() {
    inputBar.text = pluginState.getInitialInputBarContent()
  }

  function setUpReadOnlyInterval() {
    if (!pluginState.readOnlyIntervalId) {
      pluginState.readOnlyIntervalId = setInterval(() => {
        pluginState.finishWord()
        initializeBar()
      }, pluginState.readOnlyInterval)
    }
  }
  function removeReadOnlyInterval() {
    if (pluginState.readOnlyIntervalId) {
      clearInterval(pluginState.readOnlyIntervalId)
      pluginState.readOnlyIntervalId = null
    }
  }
}
