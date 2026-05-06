package main

import (
	"context"
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed build/windows/icon.ico
var iconData []byte

type App struct {
	ctx         context.Context
	isPinned    bool
	noteID      string
	noteIndex   int
}

func NewApp() *App {
	noteID := "note"
	noteIndex := 1
	for _, arg := range os.Args[1:] {
		if strings.HasPrefix(arg, "note_") {
			noteID = arg
		} else if strings.HasPrefix(arg, "index_") {
			fmt.Sscanf(arg, "index_%d", &noteIndex)
		}
	}
	return &App{
		isPinned:  false,
		noteID:    noteID,
		noteIndex: noteIndex,
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// 启动时找副屏
	a.positionToSecondaryScreen()

	// 启动系统托盘，并在协程中锁定系统线程，防止 Windows 下托盘消息循环卡死
	go func() {
		goruntime.LockOSThread()
		systray.Run(a.onTrayReady, func() {})
	}()
}

func (a *App) TogglePin() bool {
	a.isPinned = !a.isPinned
	runtime.WindowSetAlwaysOnTop(a.ctx, a.isPinned)
	return a.isPinned
}

func (a *App) HideWindow() {
	runtime.WindowHide(a.ctx)
}

func (a *App) onTrayReady() {
	systray.SetIcon(iconData)
	title := a.GetNoteTitle()
	systray.SetTooltip(title)

	mShow := systray.AddMenuItem("显示"+title, "显示便签")

	mQuit := systray.AddMenuItem("退出", "退出便签")

	systray.SetOnClick(func(menu systray.IMenu) {
		println("Tray clicked: SetOnClick")
		go func() {
			runtime.WindowShow(a.ctx)
			runtime.WindowUnminimise(a.ctx)
		}()
	})
	systray.SetOnDClick(func(menu systray.IMenu) {
		println("Tray clicked: SetOnDClick")
		go func() {
			runtime.WindowShow(a.ctx)
			runtime.WindowUnminimise(a.ctx)
		}()
	})
	systray.SetOnRClick(func(menu systray.IMenu) {
		println("Tray clicked: SetOnRClick")
		menu.ShowMenu()
	})

	mShow.Click(func() {
		go func() {
			runtime.WindowShow(a.ctx)
			runtime.WindowUnminimise(a.ctx)
		}()
	})
	mQuit.Click(func() {
		systray.Quit()
		runtime.Quit(a.ctx)
	})
}

func (a *App) positionToSecondaryScreen() {
	screens, _ := runtime.ScreenGetAll(a.ctx)
	if len(screens) > 1 {
		// Wails v2 Screen 结构体没有 Bounds 属性，也没有屏幕 X/Y 坐标信息。
		// 这里假设主屏在左侧，副屏在右侧进行简单的横向偏移定位。
		primaryWidth := screens[0].Size.Width
		for _, s := range screens {
			if s.IsPrimary {
				primaryWidth = s.Size.Width
				break
			}
		}
		// 将窗口移动到主屏宽度之后（即副屏）的 50, 50 位置
		runtime.WindowSetPosition(a.ctx, primaryWidth+50, 50)
	} else {
		// 兼容只有单屏的情况，设置一个默认位置
		runtime.WindowSetPosition(a.ctx, 50, 50)
	}
}

func (a *App) SaveNote(content string) {
	exePath, _ := os.Executable()
	dir := filepath.Dir(exePath)
	_ = os.WriteFile(filepath.Join(dir, a.noteID+".txt"), []byte(content), 0644)
}

func (a *App) LoadNote() string {
	exePath, _ := os.Executable()
	dir := filepath.Dir(exePath)
	data, err := os.ReadFile(filepath.Join(dir, a.noteID+".txt"))
	if err != nil {
		return ""
	}
	return string(data)
}

func (a *App) GetNoteTitle() string {
	if a.noteIndex == 1 {
		return "便签"
	}
	return fmt.Sprintf("便签 #%d", a.noteIndex)
}

func (a *App) NewNote() {
	exePath, _ := os.Executable()
	dir := filepath.Dir(exePath)
	
	// 计算已有的便签数量
	files, _ := os.ReadDir(dir)
	count := 0
	for _, f := range files {
		if strings.HasPrefix(f.Name(), "note") && strings.HasSuffix(f.Name(), ".txt") {
			count++
		}
	}
	// 如果当前便签还没保存（即没有文件），我们可能要确保编号正确
	if count == 0 {
		count = 1
	}

	newID := fmt.Sprintf("note_%d", time.Now().UnixNano())
	cmd := exec.Command(exePath, newID, fmt.Sprintf("index_%d", count+1))
	// 在后台运行新进程
	_ = cmd.Start()
}

func (a *App) QuitApp() {
	go func() {
		systray.Quit()
		runtime.Quit(a.ctx)
	}()
}
