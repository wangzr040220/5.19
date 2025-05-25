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
        }
    }

    // 更新按钮状态为加载中
    function setButtonLoading(button, isLoading, text = '正在生成...') {
        if (isLoading) {
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text} <span class="abort-text">(点击终止)</span>`;
        } else {
            button.innerHTML = `<i class="fas fa-paper-plane"></i> 发送`;
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

            const data = await response.json();
            
            if (data.error) {
                showError(data.error);
                return;
            }

            const assistantMessage = createAssistantMessage(data.response, data.sql);
            messageList.appendChild(assistantMessage);
            scrollToBottom();

            // 等待打字机效果完成
            await new Promise(resolve => {
                const checkGeneration = setInterval(() => {
                    if (!currentGeneration) {
                        clearInterval(checkGeneration);
                        resolve();
                    }
                }, 100);
            });

        } catch (error) {
            showError('请求失败: ' + error.message);
        } finally {
            isProcessing = false;
            userInput.disabled = false;
            setButtonLoading(sendBtn, false);
            sendBtn.onclick = sendMessage;
            userInput.focus();
        }
    }

    // 执行查询
    async function executeQuery(messageContent) {
        if (!messageContent) return;

        const confirmBtn = messageContent.querySelector('.confirm-btn');
        if (!confirmBtn) return;

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

            const data = await response.json();
            
            if (data.error) {
                showError(data.error);
                return;
            }

            const resultsSection = messageContent.querySelector('.results-section');
            if (resultsSection) {
                await displayResults(data.results, resultsSection);
                resultsSection.style.display = 'block';
            }

            if (data.response) {
                const analysisMessage = createAssistantMessage(data.response);
                messageList.appendChild(analysisMessage);
                scrollToBottom();

                // 等待打字机效果完成
                await new Promise(resolve => {
                    const checkGeneration = setInterval(() => {
                        if (!currentGeneration) {
                            clearInterval(checkGeneration);
                            resolve();
                        }
                    }, 100);
                });
            }

        } catch (error) {
            showError('执行查询失败: ' + error.message);
        } finally {
            setButtonLoading(sendBtn, false);
            sendBtn.onclick = sendMessage;
        }
    }

    // 创建用户消息元素
    function createUserMessage(text) {
        const template = userMessageTemplate.content.cloneNode(true);
        const messageText = template.querySelector('.message-text');
        messageText.textContent = text;
        return template;
    }

    // 添加打字机效果函数
    async function typewriterEffect(element, text) {
        currentGeneration = { abort: false };
        const currentGen = currentGeneration;
        
        let displayText = '';
        const words = text.split('');
        
        // 创建一个新的 div 元素用于显示 markdown
        const textDiv = document.createElement('div');
        element.appendChild(textDiv);
        
        for (const char of words) {
            if (currentGen.abort) {
                break;
            }
            displayText += char;
            textDiv.innerHTML = marked.parse(displayText);
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        
        currentGeneration = null;
    }

    // 修改createAssistantMessage函数
    function createAssistantMessage(text, sql = null) {
        console.log('创建助手消息:', '包含SQL:', !!sql);
        const template = assistantMessageTemplate.content.cloneNode(true);
        const messageText = template.querySelector('.message-text');
        messageText.innerHTML = '';
        
        if (text) {
            typewriterEffect(messageText, text);
        }

        if (sql) {
            console.log('添加SQL部分');
            const sqlSection = template.querySelector('.sql-section');
            const sqlCode = template.querySelector('.sql-query code');
            sqlCode.textContent = sql;
            sqlSection.style.display = 'block';
            
            const confirmBtn = template.querySelector('.confirm-btn');
            if (confirmBtn) {
                confirmBtn.onclick = function(event) {
                    console.log('确认按钮被点击');
                    const messageElement = event.target.closest('.message-content');
                    if (messageElement) {
                        // 点击后隐藏按钮
                        confirmBtn.style.display = 'none';
                        executeQuery(messageElement);
                    }
                };
            }
        }

        return template;
    }

    // 修改显示错误消息函数
    function showError(message) {
        const errorMessage = createAssistantMessage(`❌ ${message}`);
        messageList.appendChild(errorMessage);
        scrollToBottom();
    }

    // 修改displayResults函数，添加逐行显示效果
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
            await new Promise(resolve => setTimeout(resolve, 100)); // 每行显示的延迟
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