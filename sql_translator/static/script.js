document.addEventListener('DOMContentLoaded', function() {
    const messageList = document.getElementById('messageList');
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearBtn');
    const userMessageTemplate = document.getElementById('userMessageTemplate');
    const assistantMessageTemplate = document.getElementById('assistantMessageTemplate');

    let isProcessing = false;
    let currentGeneration = null; // 用于跟踪当前生成过程

    // 终止生成
    function abortGeneration() {
        if (currentGeneration) {
            currentGeneration.abort = true;
            // 移除最后一条助手消息
            const lastMessage = messageList.lastElementChild;
            if (lastMessage && lastMessage.classList.contains('assistant-message')) {
                messageList.removeChild(lastMessage);
            }
            setButtonLoading(sendBtn, false);
            sendBtn.onclick = sendMessage;
            userInput.disabled = false;
            isProcessing = false;
        }
    }

    // 更新按钮状态为加载中
    function setButtonLoading(button, isLoading, text = '正在生成...') {
        if (isLoading) {
            button.classList.add('loading');
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text} <span class="abort-text">(点击终止)</span>`;
            currentGeneration = { abort: false };
        } else {
            button.classList.remove('loading');
            button.innerHTML = `<i class="fas fa-paper-plane"></i> 发送`;
            currentGeneration = null;
        }
    }

    // 发送消息
    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message || isProcessing) return;

        isProcessing = true;
        userInput.value = '';
        userInput.disabled = true;
        
        setButtonLoading(sendBtn, true);
        sendBtn.onclick = abortGeneration;

        const userMessage = createUserMessage(message);
        messageList.appendChild(userMessage);
        scrollToBottom();

        // 创建一个新的助手消息元素
        const assistantMessageComponents = createAssistantMessage();
        messageList.appendChild(assistantMessageComponents.element);
        let displayText = '';

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    action: 'analyze'
                }),
            });

            // 创建 EventSource 读取流式响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                if (currentGeneration && currentGeneration.abort) {
                    reader.cancel();
                    break;
                }

                const {value, done} = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    // 如果已经终止，不再处理新的数据
                    if (currentGeneration && currentGeneration.abort) {
                        break;
                    }

                    if (line.startsWith('data: ')) {
                        const data = line.slice(5).trim();
                        
                        // 检查是否是结束标记
                        if (data === '[DONE]') {
                            console.log('收到结束标记');
                            continue;
                        }
                        
                        // 尝试解析JSON数据
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.char && !currentGeneration?.abort) {
                                displayText += parsed.char;
                                assistantMessageComponents.textDiv.innerHTML = marked.parse(displayText);
                                scrollToBottom();
                            } else if (parsed.sql && !currentGeneration?.abort) {
                                const sqlCode = assistantMessageComponents.sqlSection.querySelector('.sql-query code');
                                sqlCode.textContent = parsed.sql;
                                assistantMessageComponents.sqlSection.style.display = 'block';
                                
                                // 启用SQL执行按钮
                                if (assistantMessageComponents.confirmBtn) {
                                    assistantMessageComponents.confirmBtn.disabled = false;
                                    assistantMessageComponents.confirmBtn.style.opacity = '1';
                                    assistantMessageComponents.confirmBtn.title = '执行SQL查询';
                                    
                                    // 添加点击事件处理
                                    assistantMessageComponents.confirmBtn.onclick = function(event) {
                                        if (this.disabled) return;
                                        console.log('确认按钮被点击');
                                        const messageElement = event.target.closest('.message-content');
                                        if (messageElement) {
                                            this.style.display = 'none';
                                            executeQuery(messageElement);
                                        }
                                    };
                                }
                            }
                        } catch (e) {
                            if (!currentGeneration?.abort) {
                                console.error('解析JSON数据出错:', e, '原始数据:', data);
                            }
                            continue;
                        }
                    }
                }
            }

        } catch (error) {
            if (!currentGeneration?.abort) {
                console.error('请求失败:', error);
                showError('请求失败: ' + error.message);
            }
        } finally {
            currentGeneration = null;
            isProcessing = false;
            userInput.disabled = false;
            setButtonLoading(sendBtn, false);
            sendBtn.onclick = sendMessage;
            userInput.focus();
        }
    }

    // 执行查询
    async function executeQuery(messageElement) {
        if (!messageElement || isProcessing) return;
        
        const resultsSection = messageElement.querySelector('.results-section');
        if (!resultsSection) return;

        isProcessing = true;
        setButtonLoading(sendBtn, true, '执行查询中...');
        sendBtn.onclick = abortGeneration;

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'confirm'
                }),
            });

            if (currentGeneration && currentGeneration.abort) {
                showError('查询已取消');
                return;
            }

            const data = await response.json();
            
            if (data.error) {
                const errorMessageComponents = createAssistantMessage();
                errorMessageComponents.textDiv.innerHTML = marked.parse(`❌ ${data.error}`);
                messageList.appendChild(errorMessageComponents.element);
                scrollToBottom();
            } else {
                // 显示查询结果
                if (!currentGeneration?.abort) {
                    await displayResults(data.results, resultsSection);
                    resultsSection.style.display = 'block';

                    // 显示分析结果
                    if (data.response) {
                        const analysisMessageComponents = createAssistantMessage();
                        analysisMessageComponents.textDiv.innerHTML = marked.parse(data.response);
                        messageList.appendChild(analysisMessageComponents.element);
                        scrollToBottom();
                    }
                }
            }
        } catch (error) {
            console.error('执行查询时出错:', error);
            const errorMessageComponents = createAssistantMessage();
            errorMessageComponents.textDiv.innerHTML = marked.parse(`❌ 执行查询时发生错误: ${error.message}`);
            messageList.appendChild(errorMessageComponents.element);
            scrollToBottom();
        } finally {
            isProcessing = false;
            setButtonLoading(sendBtn, false);
            sendBtn.onclick = sendMessage;
            userInput.disabled = false;
        }
    }

    // 创建用户消息元素
    function createUserMessage(text) {
        const template = userMessageTemplate.content.cloneNode(true);
        const messageText = template.querySelector('.message-text');
        messageText.textContent = text;
        return template;
    }

    // 修改typewriterEffect函数
    async function typewriterEffect(element, text) {
        currentGeneration = { abort: false };
        const currentGen = currentGeneration;
        
        const textDiv = document.createElement('div');
        element.appendChild(textDiv);
        let displayText = '';

        // 使用更小的时间间隔，让显示更流畅
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        
        try {
            for (const char of text) {
                if (currentGen.abort) break;
                displayText += char;
                
                // 立即渲染当前字符
                textDiv.innerHTML = marked.parse(displayText);
                // 添加很小的延迟，让浏览器有时间渲染
                await delay(10);
            }
        } finally {
            currentGeneration = null;
            // 确保最后显示完整文本
            if (currentGen.abort) {
                textDiv.innerHTML = marked.parse(text);
            }
        }
    }

    // 修改createAssistantMessage函数
    function createAssistantMessage(text = '', sql = null) {
        console.log('创建助手消息:', '包含SQL:', !!sql);
        const template = assistantMessageTemplate.content.cloneNode(true);
        const messageText = template.querySelector('.message-text');
        const textDiv = document.createElement('div');
        messageText.appendChild(textDiv);
        
        const sqlSection = template.querySelector('.sql-section');
        const confirmBtn = template.querySelector('.confirm-btn');
        
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
            confirmBtn.title = '请等待消息生成完成';
        }

        if (sql) {
            console.log('添加SQL部分');
            const sqlCode = sqlSection.querySelector('.sql-query code');
            sqlCode.textContent = sql;
            sqlSection.style.display = 'block';
            
            if (confirmBtn) {
                confirmBtn.onclick = function(event) {
                    if (confirmBtn.disabled) return;
                    console.log('确认按钮被点击');
                    const messageElement = event.target.closest('.message-content');
                    if (messageElement) {
                        confirmBtn.style.display = 'none';
                        executeQuery(messageElement);
                    }
                };
            }
        }

        return {
            element: template,
            textDiv: textDiv,
            sqlSection: sqlSection,
            confirmBtn: confirmBtn
        };
    }

    // 修改显示错误消息函数
    function showError(message) {
        const errorMessageComponents = createAssistantMessage();
        errorMessageComponents.textDiv.innerHTML = marked.parse(`❌ ${message}`);
        messageList.appendChild(errorMessageComponents.element);
        scrollToBottom();
    }

    // 修改displayResults函数
    async function displayResults(results, container) {
        if (!results || results.length === 0) {
            container.innerHTML = '<div class="alert alert-info">查询执行成功，但没有返回任何结果。</div>';
            return;
        }

        const table = container.querySelector('table');
        const thead = table.querySelector('thead');
        const tbody = table.querySelector('tbody');

        // 创建表头
        const headerRow = document.createElement('tr');
        const columns = Object.keys(results[0]);
        columns.forEach(column => {
            const th = document.createElement('th');
            th.textContent = column;
            headerRow.appendChild(th);
        });
        thead.innerHTML = '';
        thead.appendChild(headerRow);

        // 逐行添加数据
        tbody.innerHTML = '';
        for (const row of results) {
            const tr = document.createElement('tr');
            for (const column of columns) {
                const td = document.createElement('td');
                td.textContent = row[column] !== null ? row[column] : 'NULL';
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
            await new Promise(resolve => setTimeout(resolve, 50)); // 减少每行显示的延迟
        }
    }

    // 滚动到底部
    function scrollToBottom() {
        messageList.scrollTop = messageList.scrollHeight;
    }

    // 清除对话
    async function clearConversation() {
        try {
            await fetch('/clear', { method: 'POST' });
            messageList.innerHTML = '';
        } catch (error) {
            console.error('清除对话失败:', error);
        }
    }

    // 事件监听
    sendBtn.addEventListener('click', sendMessage);
    clearBtn.addEventListener('click', clearConversation);

    userInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 自动聚焦输入框
    userInput.focus();
}); 