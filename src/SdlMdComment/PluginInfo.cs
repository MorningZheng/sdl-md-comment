using Sdl.Core.PluginFramework;

// 插件程序集的入口声明。Sdl.Core.PluginFramework.Build 的清单生成器靠它产出
// plugin.xml 里的 id / name（version 取程序集版本），没有它报 PFE004。
// name 传的是 PluginResources.resx 里的键，不要写字面量——清单只存键名，显示时才查表。
[assembly: Plugin("Plugin_Name")]

